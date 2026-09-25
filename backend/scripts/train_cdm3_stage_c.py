"""Train CDM-3 Stage C (SegFormer) in two explicit phases.

Phase 1:
    DACL10K remapped to the CDM-3 pathology vocabulary.
Phase 2:
    Fine-tune the Phase-1 checkpoint on curated CDM labels.

The official DACL10K polygon annotations must first be rasterized to indexed
PNG masks. Unreviewed pseudo-labels must not be used as ground truth.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import torch
from torch.utils.data import DataLoader
from transformers import AutoImageProcessor, SegformerForSemanticSegmentation

from app.cdm3.stage_c import (
    CDM3_ID2LABEL,
    CDM3_LABEL2ID,
    IGNORE_INDEX,
    SegmentationFolderDataset,
    remap_dacl10k_mask,
)

BASE_CHECKPOINT = "nvidia/mit-b0"


def build_model(init_checkpoint: str | None):
    checkpoint = init_checkpoint or BASE_CHECKPOINT
    processor = AutoImageProcessor.from_pretrained(checkpoint)
    model = SegformerForSemanticSegmentation.from_pretrained(
        checkpoint,
        num_labels=len(CDM3_ID2LABEL),
        id2label=CDM3_ID2LABEL,
        label2id=CDM3_LABEL2ID,
        ignore_mismatched_sizes=True,
    )
    return processor, model


def freeze_encoder(model):
    frozen = 0
    for name, param in model.named_parameters():
        if not name.startswith("decode_head"):
            param.requires_grad = False
            frozen += 1
    if frozen == 0:
        raise RuntimeError("Could not identify SegFormer encoder parameters.")


def update_confusion(confusion, predictions, labels):
    valid = labels != IGNORE_INDEX
    p, t = predictions[valid], labels[valid]
    n = confusion.shape[0]
    confusion += torch.bincount(t * n + p, minlength=n * n).reshape(n, n)


def class_iou(confusion):
    out = {}
    for class_id, name in CDM3_ID2LABEL.items():
        tp = confusion[class_id, class_id]
        fp = confusion[:, class_id].sum() - tp
        fn = confusion[class_id, :].sum() - tp
        denom = tp + fp + fn
        out[name] = float(tp / denom) if denom > 0 else None
    return out


def run_epoch(model, loader, device, optimizer=None):
    training = optimizer is not None
    model.train(training)
    total_loss = 0.0
    batches = 0
    confusion = torch.zeros(
        len(CDM3_ID2LABEL), len(CDM3_ID2LABEL), dtype=torch.long
    )
    for batch in loader:
        pixel_values = batch["pixel_values"].to(device)
        labels = batch["labels"].to(device)
        with torch.set_grad_enabled(training):
            output = model(pixel_values=pixel_values, labels=labels)
            loss = output.loss
        if training:
            optimizer.zero_grad()
            loss.backward()
            optimizer.step()
        total_loss += float(loss.detach())
        batches += 1
        with torch.no_grad():
            logits = torch.nn.functional.interpolate(
                output.logits,
                size=labels.shape[-2:],
                mode="bilinear",
                align_corners=False,
            )
            predictions = logits.argmax(dim=1)
            update_confusion(
                confusion,
                predictions.reshape(-1).cpu(),
                labels.reshape(-1).cpu(),
            )
    return total_loss / max(1, batches), class_iou(confusion)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--phase", required=True, choices=["dacl10k", "cdm-finetune"])
    parser.add_argument("--data-dir", required=True, type=Path)
    parser.add_argument("--val-dir", type=Path)
    parser.add_argument("--init-checkpoint")
    parser.add_argument("--out-dir", required=True, type=Path)
    parser.add_argument("--epochs", type=int, default=15)
    parser.add_argument("--batch-size", type=int, default=4)
    parser.add_argument("--lr", type=float, default=6e-5)
    parser.add_argument("--freeze-encoder", action="store_true")
    args = parser.parse_args()

    if args.phase == "cdm-finetune" and not args.init_checkpoint:
        raise SystemExit("--init-checkpoint is required for cdm-finetune.")

    processor, model = build_model(args.init_checkpoint)
    if args.freeze_encoder:
        freeze_encoder(model)

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model.to(device)
    remap = remap_dacl10k_mask if args.phase == "dacl10k" else None
    train_dataset = SegmentationFolderDataset(args.data_dir, processor, remap_fn=remap)
    train_loader = DataLoader(
        train_dataset, batch_size=args.batch_size, shuffle=True, num_workers=2
    )
    val_loader = None
    if args.val_dir:
        val_dataset = SegmentationFolderDataset(args.val_dir, processor, remap_fn=remap)
        val_loader = DataLoader(
            val_dataset, batch_size=args.batch_size, shuffle=False, num_workers=2
        )

    optimizer = torch.optim.AdamW(
        [p for p in model.parameters() if p.requires_grad], lr=args.lr
    )
    history = []
    for epoch in range(1, args.epochs + 1):
        train_loss, train_iou = run_epoch(model, train_loader, device, optimizer)
        row = {"epoch": epoch, "train_loss": train_loss, "train_iou": train_iou}
        if val_loader:
            val_loss, val_iou = run_epoch(model, val_loader, device)
            row.update({"val_loss": val_loss, "val_iou": val_iou})
        history.append(row)
        print(json.dumps(row, ensure_ascii=False))

    args.out_dir.mkdir(parents=True, exist_ok=True)
    model.save_pretrained(args.out_dir)
    processor.save_pretrained(args.out_dir)
    (args.out_dir / "training_history.json").write_text(
        json.dumps({"phase": args.phase, "history": history}, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
