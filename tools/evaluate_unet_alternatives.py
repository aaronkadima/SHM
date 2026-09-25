#!/usr/bin/env python3
"""Evaluate alternate public U-Net crack checkpoints against a labeled real image.

This does not promote any checkpoint. It creates an auditable report so a replacement
for unet_public_crack is only considered after a supervised quality gate passes.
"""
from __future__ import annotations
import argparse, json, os, sys, urllib.request
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
from huggingface_hub import HfApi,hf_hub_download
from PIL import Image

ROOT=Path(__file__).resolve().parents[1]
IMAGE_URL="https://raw.githubusercontent.com/amirrezaie1415/Concrete-Crack-Segmentation/master/docs/imgs/254_768_0.png"
MASK_URL="https://raw.githubusercontent.com/amirrezaie1415/Concrete-Crack-Segmentation/master/docs/imgs/254_768_0_mask.png"

class VizuaraUNet(nn.Module):
    def __init__(self):
        super().__init__()
        def block(a,b):
            return nn.Sequential(
                nn.Conv2d(a,b,3,padding=1),nn.ReLU(inplace=True),
                nn.Conv2d(b,b,3,padding=1),nn.ReLU(inplace=True),
            )
        self.enc1=block(3,64);self.enc2=block(64,128);self.enc3=block(128,256);self.enc4=block(256,512)
        self.pool=nn.MaxPool2d(2)
        self.bottleneck=block(512,1024)
        self.upconv4=nn.ConvTranspose2d(1024,512,2,2);self.dec4=block(1024,512)
        self.upconv3=nn.ConvTranspose2d(512,256,2,2);self.dec3=block(512,256)
        self.upconv2=nn.ConvTranspose2d(256,128,2,2);self.dec2=block(256,128)
        self.upconv1=nn.ConvTranspose2d(128,64,2,2);self.dec1=block(128,64)
        self.conv_last=nn.Conv2d(64,1,1)
    def forward(self,x):
        c1=self.enc1(x);c2=self.enc2(self.pool(c1));c3=self.enc3(self.pool(c2));c4=self.enc4(self.pool(c3))
        b=self.bottleneck(self.pool(c4))
        x=self.dec4(torch.cat([self.upconv4(b),c4],1))
        x=self.dec3(torch.cat([self.upconv3(x),c3],1))
        x=self.dec2(torch.cat([self.upconv2(x),c2],1))
        x=self.dec1(torch.cat([self.upconv1(x),c1],1))
        return torch.sigmoid(self.conv_last(x))

def download(url: str,path: Path)->Path:
    path.parent.mkdir(parents=True,exist_ok=True)
    req=urllib.request.Request(url,headers={"User-Agent":"SHM-unet-alternative-eval/1.0"})
    with urllib.request.urlopen(req,timeout=60) as r:path.write_bytes(r.read())
    return path

def load_pair(root:Path):
    ip=download(IMAGE_URL,root/"labeled-image.png")
    mp=download(MASK_URL,root/"labeled-mask.png")
    image=Image.open(ip).convert("RGB").resize((128,128),Image.Resampling.LANCZOS)
    mask=np.asarray(Image.open(mp).convert("L").resize((128,128),Image.Resampling.NEAREST),dtype=np.uint8)
    gt=binary_ground_truth(Image.fromarray(mask))
    x=torch.from_numpy(np.asarray(image,dtype=np.float32)/255.0).permute(2,0,1).unsqueeze(0)
    return x,gt


def binary_ground_truth(mask_image:Image.Image,size=(128,128)):
    raw=np.asarray(mask_image.convert("L").resize(size,Image.Resampling.NEAREST),dtype=np.uint8)
    white=raw>=128
    return white if float(white.mean())<=.5 else np.logical_not(white)

def fixed_metrics(prob:np.ndarray,gt:np.ndarray,mode:str,threshold:float):
    foreground=prob if mode=="direct" else 1.0-prob
    pred=foreground>=float(threshold)
    inter=int(np.logical_and(pred,gt).sum());union=int(np.logical_or(pred,gt).sum())
    tp=inter;fp=int(np.logical_and(pred,np.logical_not(gt)).sum());fn=int(np.logical_and(np.logical_not(pred),gt).sum())
    iou=1.0 if union==0 else inter/union
    dice=1.0 if (2*tp+fp+fn)==0 else (2*tp)/(2*tp+fp+fn)
    return {
        "iou":float(iou),"dice":float(dice),
        "prediction_area_ratio":float(pred.mean()),"ground_truth_area_ratio":float(gt.mean()),
        "area_ratio_abs_delta":abs(float(pred.mean())-float(gt.mean())),
    }

def load_external_pairs(root:Path,per_scenario=2):
    api=HfApi()
    files=api.list_repo_files("Mr-Perfectuz/crack",repo_type="dataset")
    scenarios=["Sun520_full_resolution","Rain365_full_resolution","BJN260_full_resolution"]
    pairs=[]
    for scenario in scenarios:
        images=[x for x in files if x.startswith(scenario+"/img/") and Path(x).suffix.lower() in {".jpg",".jpeg",".png"}]
        masks=[x for x in files if x.startswith(scenario+"/gt/") and Path(x).suffix.lower() in {".jpg",".jpeg",".png"}]
        mask_by_stem={Path(x).stem:x for x in masks}
        matched=[(x,mask_by_stem.get(Path(x).stem)) for x in sorted(images)]
        matched=[x for x in matched if x[1]][:per_scenario]
        for image_file,mask_file in matched:
            image_path=hf_hub_download(repo_id="Mr-Perfectuz/crack",filename=image_file,repo_type="dataset",cache_dir="/tmp/shm-crack-external")
            mask_path=hf_hub_download(repo_id="Mr-Perfectuz/crack",filename=mask_file,repo_type="dataset",cache_dir="/tmp/shm-crack-external")
            pairs.append({
                "scenario":scenario,
                "image_file":image_file,
                "mask_file":mask_file,
                "image":Image.open(image_path).convert("RGB"),
                "mask":Image.open(mask_path).convert("L"),
            })
    if len(pairs)<3:
        raise RuntimeError("Could not resolve enough external crack image/mask pairs from Mr-Perfectuz/crack")
    return pairs

def evaluate_external(model:nn.Module,pairs,mode:str,threshold:float):
    cases=[]
    for item in pairs:
        image=item["image"].resize((128,128),Image.Resampling.LANCZOS)
        x=torch.from_numpy(np.asarray(image,dtype=np.float32)/255.0).permute(2,0,1).unsqueeze(0)
        with torch.inference_mode():prob=model(x)[0,0].cpu().numpy().astype(np.float32)
        gt=binary_ground_truth(item["mask"])
        metrics=fixed_metrics(prob,gt,mode,threshold)
        cases.append({"scenario":item["scenario"],"image_file":item["image_file"],"mask_file":item["mask_file"],**metrics})
    return {
        "dataset":"Mr-Perfectuz/crack",
        "license":"MIT",
        "role":"external-cross-domain-generalization",
        "count":len(cases),
        "mean_iou":float(np.mean([x["iou"] for x in cases])),
        "min_iou":float(np.min([x["iou"] for x in cases])),
        "mean_dice":float(np.mean([x["dice"] for x in cases])),
        "mean_area_ratio_abs_delta":float(np.mean([x["area_ratio_abs_delta"] for x in cases])),
        "cases":cases,
    }

def score(prob:np.ndarray,gt:np.ndarray):
    thresholds=np.unique(np.concatenate([np.linspace(.01,.25,25),np.linspace(.26,.90,33),np.linspace(.91,.999,46)])).astype(np.float32)
    modes={}
    for mode,foreground in (("direct",prob),("inverted",1-prob)):
        best=None
        for threshold in thresholds:
            pred=foreground>=float(threshold)
            inter=int(np.logical_and(pred,gt).sum());union=int(np.logical_or(pred,gt).sum())
            tp=inter;fp=int(np.logical_and(pred,np.logical_not(gt)).sum());fn=int(np.logical_and(np.logical_not(pred),gt).sum())
            iou=1.0 if union==0 else inter/union
            dice=1.0 if (2*tp+fp+fn)==0 else (2*tp)/(2*tp+fp+fn)
            area=float(pred.mean());delta=abs(area-float(gt.mean()))
            row={"threshold":float(threshold),"iou":float(iou),"dice":float(dice),"prediction_area_ratio":area,"area_ratio_abs_delta":delta}
            if best is None or (row["iou"],row["dice"],-row["area_ratio_abs_delta"])>(best["iou"],best["dice"],-best["area_ratio_abs_delta"]):best=row
        modes[mode]=best
    mode=max(modes,key=lambda k:(modes[k]["iou"],modes[k]["dice"],-modes[k]["area_ratio_abs_delta"]))
    selected=modes[mode]
    return{
        "ground_truth_area_ratio":float(gt.mean()),
        "probability":{"min":float(prob.min()),"mean":float(prob.mean()),"max":float(prob.max())},
        "direct":modes["direct"],"inverted":modes["inverted"],
        "selected_mode":mode,"selected_threshold":selected["threshold"],"selected_iou":selected["iou"],"selected_dice":selected["dice"],
        "selected_area_ratio_abs_delta":selected["area_ratio_abs_delta"],
        "passed":bool(selected["iou"]>=.50 and selected["dice"]>=.65 and selected["area_ratio_abs_delta"]<=.10),
    }

def evaluate(filename:str,x,gt,external_pairs):
    path=hf_hub_download(repo_id="Vizuara/unet-crack-segmentation",filename=filename,cache_dir="/tmp/shm-vizuara-unet")
    model=VizuaraUNet().eval()
    state=torch.load(path,map_location="cpu",weights_only=True)
    model.load_state_dict(state,strict=True)
    with torch.inference_mode():prob=model(x)[0,0].cpu().numpy().astype(np.float32)
    primary=score(prob,gt)
    external=evaluate_external(model,external_pairs,primary["selected_mode"],primary["selected_threshold"])
    external["screening_pass"]=bool(external["mean_iou"]>=.35 and external["mean_dice"]>=.50 and external["mean_area_ratio_abs_delta"]<=.15)
    return{
        "source_repo":"Vizuara/unet-crack-segmentation","source_file":filename,
        "source_space":"Vizuara/UNet-for-crack-detection-in-concrete",
        "license_status":"space-code-mit; model-repo-license-unspecified",
        "input_size":[128,128],
        "metrics":primary,
        "external_validation":external,
    }

def main():
    p=argparse.ArgumentParser();p.add_argument("--out",default=str(ROOT/"browser-models"/"artifacts"/"unet_public_crack"/"alternatives.json"))
    a=p.parse_args();out=Path(a.out);x,gt=load_pair(out.parent);external_pairs=load_external_pairs(out.parent)
    candidates=[evaluate("unet_weights.pth",x,gt,external_pairs),evaluate("unet_weights_v2.pth",x,gt,external_pairs)]
    candidates.sort(key=lambda c:(c["metrics"]["passed"],c["external_validation"]["screening_pass"],c["external_validation"]["mean_iou"],c["metrics"]["selected_iou"]),reverse=True)
    report={
        "schema":"shm-unet-alternatives-v1",
        "reference":{"image":IMAGE_URL,"mask":MASK_URL,"ground_truth_rule":"minority-of-binary-mask"},
        "gate":{"iou_min":.50,"dice_min":.65,"area_ratio_abs_delta_max":.10},
        "candidates":candidates,
        "best_candidate":candidates[0]["source_file"] if candidates else None,
        "any_quality_pass":any(c["metrics"]["passed"] and c["external_validation"]["screening_pass"] for c in candidates),
        "promotion_allowed":False,
        "promotion_blockers":[
            "Model repository does not currently declare an explicit model license/card.",
            "Multi-image external screening must remain positive, and a concrete-only validation set is still required before replacement."
        ],
    }
    out.parent.mkdir(parents=True,exist_ok=True);out.write_text(json.dumps(report,indent=2,ensure_ascii=False)+"\n",encoding="utf-8")
    print(json.dumps(report,indent=2,ensure_ascii=False))

if __name__=="__main__":main()
