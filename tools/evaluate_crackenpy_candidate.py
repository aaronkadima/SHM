#!/usr/bin/env python3
"""Evaluate CrackenPy model1 as a licensed crack-segmentation candidate for SHM.

No promotion or catalog mutation is performed here. The evaluator reconstructs the
published segmentation_models_pytorch FPN from model1.json, loads model1.pt with
weights_only=True, then measures the crack class on:
- a labeled concrete-crack reference image;
- a small, deterministic cross-domain road-crack set.
"""
from __future__ import annotations
import argparse, json, urllib.request
from pathlib import Path

import numpy as np
import torch
from PIL import Image
from huggingface_hub import HfApi, hf_hub_download
import segmentation_models_pytorch as smp

ROOT=Path(__file__).resolve().parents[1]
REPO_ID="rievil/crackenpy"
MODEL_FILE="model1.pt"
CONFIG_FILE="model1.json"
LICENSE="BSD"
DOI="10.57967/hf/3295"
CONCRETE_IMAGE_URL="https://raw.githubusercontent.com/amirrezaie1415/Concrete-Crack-Segmentation/master/docs/imgs/254_768_0.png"
CONCRETE_MASK_URL="https://raw.githubusercontent.com/amirrezaie1415/Concrete-Crack-Segmentation/master/docs/imgs/254_768_0_mask.png"
ROAD_DATASET="Mr-Perfectuz/crack"
MEAN=np.asarray([.485,.456,.406],dtype=np.float32).reshape(1,1,3)
STD=np.asarray([.229,.224,.225],dtype=np.float32).reshape(1,1,3)

def download(url:str,path:Path)->Path:
    path.parent.mkdir(parents=True,exist_ok=True)
    req=urllib.request.Request(url,headers={"User-Agent":"SHM-crackenpy-eval/1.0"})
    with urllib.request.urlopen(req,timeout=90) as r:path.write_bytes(r.read())
    return path

def load_model():
    cfg_path=hf_hub_download(repo_id=REPO_ID,filename=CONFIG_FILE,cache_dir="/tmp/shm-crackenpy")
    weights=hf_hub_download(repo_id=REPO_ID,filename=MODEL_FILE,cache_dir="/tmp/shm-crackenpy")
    cfg=json.loads(Path(cfg_path).read_text(encoding="utf-8"))
    encoder=cfg.get("model_type") or cfg.get("encoder_name") or "resnext50_32x4d"
    classes=int(cfg.get("num_classes",4))
    channels=int(cfg.get("num_channels",cfg.get("in_channels",3)))
    depth=int(cfg.get("num_encoders",5))
    size=int(cfg.get("image_size",416))
    model=smp.FPN(encoder_name=encoder,in_channels=channels,classes=classes,activation=None,encoder_depth=depth)
    state=torch.load(weights,map_location="cpu",weights_only=True)
    model.load_state_dict(state,strict=True);model.eval()
    return model,cfg,Path(weights),size

def preprocess(image:Image.Image,size:int)->torch.Tensor:
    arr=np.asarray(image.convert("RGB").resize((size,size),Image.Resampling.BILINEAR),dtype=np.float32)/255.0
    arr=(arr-MEAN)/STD
    return torch.from_numpy(np.transpose(arr,(2,0,1))).unsqueeze(0).float()

def binary_gt(mask:Image.Image,size:int)->np.ndarray:
    raw=np.asarray(mask.convert("L").resize((size,size),Image.Resampling.NEAREST),dtype=np.uint8)
    white=raw>=128
    # Crack annotation is expected to be sparse.
    return white if float(white.mean())<=.5 else np.logical_not(white)

def metrics(pred:np.ndarray,gt:np.ndarray):
    pred=np.asarray(pred,dtype=bool);gt=np.asarray(gt,dtype=bool)
    inter=int(np.logical_and(pred,gt).sum());union=int(np.logical_or(pred,gt).sum())
    tp=inter;fp=int(np.logical_and(pred,np.logical_not(gt)).sum());fn=int(np.logical_and(np.logical_not(pred),gt).sum())
    iou=1.0 if union==0 else inter/union
    dice=1.0 if (2*tp+fp+fn)==0 else (2*tp)/(2*tp+fp+fn)
    return{
        "iou":float(iou),"dice":float(dice),
        "prediction_area_ratio":float(pred.mean()),
        "ground_truth_area_ratio":float(gt.mean()),
        "area_ratio_abs_delta":abs(float(pred.mean())-float(gt.mean())),
    }

def infer_crack(model,image:Image.Image,size:int,crack_id:int=2):
    with torch.inference_mode():
        logits=model(preprocess(image,size))
        probs=torch.softmax(logits,dim=1)[0].cpu().numpy()
        classes=np.argmax(probs,axis=0)
    return classes==crack_id,probs[crack_id],probs

def concrete_case(model,size:int,root:Path):
    ip=download(CONCRETE_IMAGE_URL,root/"concrete-reference.png")
    mp=download(CONCRETE_MASK_URL,root/"concrete-reference-mask.png")
    pred,crack_prob,_=infer_crack(model,Image.open(ip),size)
    gt=binary_gt(Image.open(mp),size)
    return{
        **metrics(pred,gt),
        "crack_probability":{"min":float(crack_prob.min()),"mean":float(crack_prob.mean()),"max":float(crack_prob.max())},
        "image":CONCRETE_IMAGE_URL,"mask":CONCRETE_MASK_URL,
    }

def road_cases(model,size:int,per_scenario=2):
    api=HfApi();files=api.list_repo_files(ROAD_DATASET,repo_type="dataset")
    scenarios=["Sun520_full_resolution","Rain365_full_resolution","BJN260_full_resolution"]
    rows=[]
    for scenario in scenarios:
        images=[x for x in files if x.startswith(scenario+"/img/") and Path(x).suffix.lower() in {".png",".jpg",".jpeg"}]
        masks=[x for x in files if x.startswith(scenario+"/gt/") and Path(x).suffix.lower() in {".png",".jpg",".jpeg"}]
        mask_by_stem={Path(x).stem:x for x in masks}
        pairs=[(x,mask_by_stem.get(Path(x).stem)) for x in sorted(images)]
        pairs=[x for x in pairs if x[1]]
        if len(pairs)>per_scenario:
            idx=np.linspace(0,len(pairs)-1,per_scenario,dtype=int)
            pairs=[pairs[int(i)] for i in idx]
        for image_file,mask_file in pairs:
            ip=hf_hub_download(repo_id=ROAD_DATASET,filename=image_file,repo_type="dataset",cache_dir="/tmp/shm-crackenpy-road")
            mp=hf_hub_download(repo_id=ROAD_DATASET,filename=mask_file,repo_type="dataset",cache_dir="/tmp/shm-crackenpy-road")
            pred,_,_=infer_crack(model,Image.open(ip),size)
            gt=binary_gt(Image.open(mp),size)
            rows.append({"scenario":scenario,"image_file":image_file,"mask_file":mask_file,**metrics(pred,gt)})
    return{
        "dataset":ROAD_DATASET,"license":"MIT","count":len(rows),
        "mean_iou":float(np.mean([x["iou"] for x in rows])),
        "min_iou":float(np.min([x["iou"] for x in rows])),
        "mean_dice":float(np.mean([x["dice"] for x in rows])),
        "mean_area_ratio_abs_delta":float(np.mean([x["area_ratio_abs_delta"] for x in rows])),
        "cases":rows,
    }

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--out",default=str(ROOT/"browser-models"/"artifacts"/"crackenpy_public_crack"/"evaluation.json"))
    a=p.parse_args();out=Path(a.out);out.parent.mkdir(parents=True,exist_ok=True)
    model,cfg,weights,size=load_model()
    concrete=concrete_case(model,size,out.parent)
    road=road_cases(model,size)
    gate={
        "concrete_iou_min":.35,"concrete_dice_min":.50,"concrete_area_ratio_abs_delta_max":.20,
        "road_mean_iou_advisory_min":.15,
    }
    concrete_pass=bool(
        concrete["iou"]>=gate["concrete_iou_min"] and
        concrete["dice"]>=gate["concrete_dice_min"] and
        concrete["area_ratio_abs_delta"]<=gate["concrete_area_ratio_abs_delta_max"]
    )
    report={
        "schema":"shm-crackenpy-candidate-v1",
        "candidate_id":"crackenpy_public_crack",
        "source_repo":REPO_ID,"source_file":MODEL_FILE,"config_file":CONFIG_FILE,
        "license":LICENSE,"doi":DOI,"model_bytes":weights.stat().st_size,
        "published_config":cfg,"resolved_input_size":size,"crack_class_id":2,
        "concrete_reference":concrete,"cross_domain_road":road,
        "gate":{**gate,"concrete_pass":concrete_pass,"road_advisory_pass":bool(road["mean_iou"]>=gate["road_mean_iou_advisory_min"])},
        "promotion_allowed":False,
        "next_step":"Export/quantize to ONNX only if concrete_pass is true; exterior-road score remains advisory because the source model explicitly targets laboratory building-material specimens.",
    }
    out.write_text(json.dumps(report,indent=2,ensure_ascii=False)+"\n",encoding="utf-8")
    print(json.dumps(report,indent=2,ensure_ascii=False))

if __name__=="__main__":main()
