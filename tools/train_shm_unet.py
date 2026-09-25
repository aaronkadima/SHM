#!/usr/bin/env python3
"""Train a compact SHM-owned U-Net on the CC BY 4.0 Concrete Crack Segmentation Dataset.

The pipeline is intentionally conservative:
- deterministic dataset discovery/split;
- train/validation/test separation;
- validation-only threshold selection;
- independent test metrics;
- ONNX export only after a minimum quality gate.
"""
from __future__ import annotations
import argparse, hashlib, io, json, math, os, random, shutil, urllib.request, zipfile
from pathlib import Path

import numpy as np
from PIL import Image
import torch
import torch.nn as nn
import torch.nn.functional as F

ROOT=Path(__file__).resolve().parents[1]
DATASET_URL="https://prod-dcd-datasets-cache-zipfiles.s3.eu-west-1.amazonaws.com/jwsn7tfbrp-1.zip"
DATASET_DOI="10.17632/jwsn7tfbrp.1"
DATASET_LICENSE="CC BY 4.0"
SEED=26092026

def norm_key(path:Path)->str:
    stem=path.stem.lower()
    for token in ("_mask","-mask"," mask","_alpha","-alpha"," alpha","_label","-label","_gt","-gt","_groundtruth","_ground_truth"):
        stem=stem.replace(token,"")
    return "".join(ch for ch in stem if ch.isalnum())

def is_mask_path(path:Path)->bool:
    s="/".join(x.lower() for x in path.parts)
    return any(k in s for k in ("/mask","/label","/ground","/gt","/alpha","mask/","label/","ground/","alpha/"))

def download_zip(target:Path)->Path:
    target.parent.mkdir(parents=True,exist_ok=True)
    if target.exists() and target.stat().st_size>1_000_000:return target
    req=urllib.request.Request(DATASET_URL,headers={"User-Agent":"SHM-UNet-training/1.0"})
    with urllib.request.urlopen(req,timeout=180) as r, target.open("wb") as f:
        shutil.copyfileobj(r,f)
    return target

def discover_pairs(root:Path):
    exts={".png",".jpg",".jpeg",".bmp",".tif",".tiff"}
    files=[p for p in root.rglob("*") if p.is_file() and p.suffix.lower() in exts]
    masks=[p for p in files if is_mask_path(p)]
    images=[p for p in files if p not in set(masks)]
    img_by_key={}
    for p in images:img_by_key.setdefault(norm_key(p),[]).append(p)
    pairs=[]
    for mask in masks:
        candidates=img_by_key.get(norm_key(mask),[])
        if candidates:
            # Prefer a source image outside the mask directory and with the closest filename.
            image=sorted(candidates,key=lambda p:(p.parent==mask.parent,len(str(p))))[0]
            pairs.append((image,mask))
    # Fallback: detect pairs by same basename across folders if mask folder keyword was absent.
    if len(pairs)<50:
        by_key={}
        for p in files:by_key.setdefault(norm_key(p),[]).append(p)
        for key,items in by_key.items():
            if len(items)<2:continue
            pngs=[x for x in items if x.suffix.lower()==".png"]
            photos=[x for x in items if x.suffix.lower() in {".jpg",".jpeg",".bmp",".tif",".tiff"}]
            if pngs and photos:pairs.append((photos[0],pngs[0]))
    unique={}
    for image,mask in pairs:unique[(str(image),str(mask))]=(image,mask)
    return list(unique.values()),files

def split_name(image:Path)->str:
    x=int(hashlib.sha256(str(image).encode()).hexdigest()[:8],16)%100
    return "train" if x<70 else ("val" if x<85 else "test")

def mask_array(mask:Image.Image,size:int)->np.ndarray:
    arr=np.asarray(mask.convert("L").resize((size,size),Image.Resampling.NEAREST),dtype=np.uint8)
    white=arr>=128
    # Crack is sparse; normalize annotation polarity by treating minority binary region as foreground.
    fg=white if float(white.mean())<=.5 else np.logical_not(white)
    return fg.astype(np.float32)

def image_array(image:Image.Image,size:int)->np.ndarray:
    return np.asarray(image.convert("RGB").resize((size,size),Image.Resampling.LANCZOS),dtype=np.float32)/255.0

class PairDataset(torch.utils.data.Dataset):
    def __init__(self,pairs,size,augment=False):
        self.pairs=pairs;self.size=size;self.augment=augment
    def __len__(self):return len(self.pairs)
    def __getitem__(self,index):
        image_path,mask_path=self.pairs[index]
        image=image_array(Image.open(image_path),self.size)
        mask=mask_array(Image.open(mask_path),self.size)
        if self.augment:
            rng=random.Random(SEED+index+random.randint(0,1_000_000))
            if rng.random()<.5:image=np.flip(image,1).copy();mask=np.flip(mask,1).copy()
            if rng.random()<.5:image=np.flip(image,0).copy();mask=np.flip(mask,0).copy()
            k=rng.randrange(4)
            if k:image=np.rot90(image,k).copy();mask=np.rot90(mask,k).copy()
            # Mild photometric augmentation without changing mask geometry.
            gain=rng.uniform(.9,1.1);bias=rng.uniform(-.04,.04)
            image=np.clip(image*gain+bias,0,1)
        x=torch.from_numpy(image).permute(2,0,1).float()
        y=torch.from_numpy(mask).unsqueeze(0).float()
        return x,y

class CompactUNet(nn.Module):
    def __init__(self,base=16):
        super().__init__()
        def block(a,b):
            return nn.Sequential(nn.Conv2d(a,b,3,padding=1,bias=False),nn.BatchNorm2d(b),nn.ReLU(inplace=True),
                                 nn.Conv2d(b,b,3,padding=1,bias=False),nn.BatchNorm2d(b),nn.ReLU(inplace=True))
        self.e1=block(3,base);self.e2=block(base,base*2);self.e3=block(base*2,base*4);self.e4=block(base*4,base*8)
        self.pool=nn.MaxPool2d(2);self.b=block(base*8,base*16)
        self.u4=nn.ConvTranspose2d(base*16,base*8,2,2);self.d4=block(base*16,base*8)
        self.u3=nn.ConvTranspose2d(base*8,base*4,2,2);self.d3=block(base*8,base*4)
        self.u2=nn.ConvTranspose2d(base*4,base*2,2,2);self.d2=block(base*4,base*2)
        self.u1=nn.ConvTranspose2d(base*2,base,2,2);self.d1=block(base*2,base)
        self.out=nn.Conv2d(base,1,1)
    def forward(self,x):
        c1=self.e1(x);c2=self.e2(self.pool(c1));c3=self.e3(self.pool(c2));c4=self.e4(self.pool(c3));b=self.b(self.pool(c4))
        x=self.d4(torch.cat([self.u4(b),c4],1));x=self.d3(torch.cat([self.u3(x),c3],1))
        x=self.d2(torch.cat([self.u2(x),c2],1));x=self.d1(torch.cat([self.u1(x),c1],1))
        return torch.sigmoid(self.out(x))

def dice_loss(prob,target,eps=1e-6):
    inter=(prob*target).sum(dim=(1,2,3));den=prob.sum(dim=(1,2,3))+target.sum(dim=(1,2,3))
    return (1-((2*inter+eps)/(den+eps))).mean()

def loss_fn(prob,target):
    # Positive pixels are sparse; BCE pos weighting is approximated through focal emphasis + Dice.
    bce=F.binary_cross_entropy(prob.clamp(1e-6,1-1e-6),target,reduction="none")
    weight=torch.where(target>.5,torch.tensor(4.0,device=target.device),torch.tensor(1.0,device=target.device))
    return .45*(bce*weight).mean()+.55*dice_loss(prob,target)

def collect_predictions(model,loader):
    model.eval();rows=[]
    with torch.inference_mode():
        for x,y in loader:
            p=model(x).cpu().numpy()[:,0];gt=y.cpu().numpy()[:,0]
            rows.extend((pp,gg) for pp,gg in zip(p,gt))
    return rows

def binary_metrics(rows,threshold):
    ious=[];dices=[];area_delta=[]
    for prob,gt in rows:
        pred=prob>=threshold;truth=gt>=.5
        inter=np.logical_and(pred,truth).sum();union=np.logical_or(pred,truth).sum()
        tp=inter;fp=np.logical_and(pred,~truth).sum();fn=np.logical_and(~pred,truth).sum()
        iou=1.0 if union==0 else inter/union
        dice=1.0 if 2*tp+fp+fn==0 else (2*tp)/(2*tp+fp+fn)
        ious.append(float(iou));dices.append(float(dice));area_delta.append(abs(float(pred.mean())-float(truth.mean())))
    return{"mean_iou":float(np.mean(ious)),"median_iou":float(np.median(ious)),"mean_dice":float(np.mean(dices)),
           "median_dice":float(np.median(dices)),"mean_area_ratio_abs_delta":float(np.mean(area_delta)),"count":len(rows)}

def choose_threshold(rows):
    candidates=np.linspace(.10,.90,33)
    scored=[(float(t),binary_metrics(rows,float(t))) for t in candidates]
    return max(scored,key=lambda x:(x[1]["mean_iou"],x[1]["mean_dice"],-x[1]["mean_area_ratio_abs_delta"]))

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--out-dir",default=str(ROOT/"browser-models"/"artifacts"/"shm_unet_crack"))
    p.add_argument("--epochs",type=int,default=6)
    p.add_argument("--size",type=int,default=256)
    p.add_argument("--base",type=int,default=16)
    p.add_argument("--batch-size",type=int,default=4)
    p.add_argument("--max-pairs",type=int,default=458)
    a=p.parse_args()

    random.seed(SEED);np.random.seed(SEED);torch.manual_seed(SEED);torch.set_num_threads(max(1,min(4,os.cpu_count() or 2)))
    out=Path(a.out_dir);out.mkdir(parents=True,exist_ok=True)
    archive=download_zip(Path("/tmp/shm-concrete-crack-segmentation.zip"))
    extract=Path("/tmp/shm-concrete-crack-segmentation")
    if not extract.exists():
        extract.mkdir(parents=True,exist_ok=True)
        with zipfile.ZipFile(archive) as z:z.extractall(extract)
    pairs,all_files=discover_pairs(extract)
    if len(pairs)<100:
        sample=[str(p.relative_to(extract)) for p in all_files[:120]]
        raise SystemExit("Insufficient image/mask pairs discovered: "+str(len(pairs))+"\n"+json.dumps(sample,indent=2))
    pairs=sorted(pairs,key=lambda x:str(x[0]))[:a.max_pairs]
    splits={k:[] for k in ("train","val","test")}
    for pair in pairs:splits[split_name(pair[0])].append(pair)
    if min(map(len,splits.values()))<10:raise SystemExit("Split too small: "+repr({k:len(v) for k,v in splits.items()}))

    loaders={}
    for name in splits:
        ds=PairDataset(splits[name],a.size,augment=(name=="train"))
        loaders[name]=torch.utils.data.DataLoader(ds,batch_size=a.batch_size if name=="train" else max(1,a.batch_size),shuffle=(name=="train"),num_workers=0)

    model=CompactUNet(a.base)
    opt=torch.optim.AdamW(model.parameters(),lr=1e-3,weight_decay=1e-4)
    history=[]
    for epoch in range(1,a.epochs+1):
        model.train();losses=[]
        for x,y in loaders["train"]:
            opt.zero_grad(set_to_none=True);p=model(x);loss=loss_fn(p,y);loss.backward();opt.step();losses.append(float(loss.item()))
        val_rows=collect_predictions(model,loaders["val"]);thr,val_metrics=choose_threshold(val_rows)
        history.append({"epoch":epoch,"train_loss":float(np.mean(losses)),"val_threshold":thr,**val_metrics})
        print(json.dumps(history[-1]),flush=True)

    val_rows=collect_predictions(model,loaders["val"]);threshold,val_metrics=choose_threshold(val_rows)
    test_rows=collect_predictions(model,loaders["test"]);test_metrics=binary_metrics(test_rows,threshold)
    gate={
        "mean_iou_min":.45,"mean_dice_min":.60,"mean_area_ratio_abs_delta_max":.12,
        "passed":bool(test_metrics["mean_iou"]>=.45 and test_metrics["mean_dice"]>=.60 and test_metrics["mean_area_ratio_abs_delta"]<=.12),
    }
    checkpoint=out/"shm_unet_crack.pt";torch.save(model.state_dict(),checkpoint)
    report={
        "schema":"shm-owned-unet-training-v1","engine_id":"shm_unet_crack","seed":SEED,
        "dataset":{"url":DATASET_URL,"doi":DATASET_DOI,"license":DATASET_LICENSE,"pairs":len(pairs),
                   "split_counts":{k:len(v) for k,v in splits.items()}},
        "model":{"architecture":"CompactUNet","base":a.base,"input_size":[a.size,a.size]},
        "training":{"epochs":a.epochs,"batch_size":a.batch_size,"history":history},
        "validation":{"selected_threshold":threshold,**val_metrics},"test":test_metrics,"gate":gate,
        "checkpoint":checkpoint.name,
    }
    (out/"training-report.json").write_text(json.dumps(report,indent=2,ensure_ascii=False)+"\n",encoding="utf-8")

    if gate["passed"]:
        onnx_path=out/"model.onnx"
        model.eval()
        torch.onnx.export(model,torch.randn(1,3,a.size,a.size),onnx_path,input_names=["images"],output_names=["mask"],opset_version=17,
                          dynamic_axes={"images":{0:"batch"},"mask":{0:"batch"}})
        report["onnx"]=onnx_path.name
        (out/"training-report.json").write_text(json.dumps(report,indent=2,ensure_ascii=False)+"\n",encoding="utf-8")
    print(json.dumps(report,indent=2,ensure_ascii=False))

if __name__=="__main__":main()
