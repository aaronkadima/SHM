#!/usr/bin/env python3
"""Generate a deterministic YOLOv8n crack-seg parity fixture and backend reference."""
from __future__ import annotations
import argparse,hashlib,json,os,sys
from pathlib import Path

import numpy as np
from PIL import Image,ImageDraw,ImageFilter

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/"backend"))

from app.adapters.hf_pathology_adapters import public_pathology_catalog

ENGINE_ID="yolov8n_public_crack_seg"

def sha256(path:Path)->str:
    h=hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda:f.read(1024*1024),b""):h.update(chunk)
    return h.hexdigest()

def build_fixture(path:Path)->Image.Image:
    # Deterministic, concrete-like RGB surface with high-contrast branching cracks.
    rng=np.random.default_rng(26092026)
    w,h=384,288
    base=np.full((h,w,3),176,dtype=np.float32)
    noise=rng.normal(0,4.2,size=(h,w,1))
    gradient=np.linspace(4,-5,w,dtype=np.float32)[None,:,None]
    arr=np.clip(base+noise+gradient,0,255).astype(np.uint8)
    image=Image.fromarray(arr,"RGB")
    # Draw on 3x supersampled canvas for stable antialiasing.
    scale=3
    hi=image.resize((w*scale,h*scale),Image.Resampling.BICUBIC)
    draw=ImageDraw.Draw(hi)
    def line(points,width=3,fill=(42,40,38)):
        draw.line([(int(x*scale),int(y*scale)) for x,y in points],fill=fill,width=width*scale,joint="curve")
    line([(22,246),(52,226),(83,211),(111,190),(142,169),(176,147),(210,121),(248,99),(282,75),(327,48),(365,27)],4)
    line([(142,169),(129,145),(118,123),(111,102),(105,84)],2)
    line([(248,99),(267,121),(281,143),(296,163)],2)
    line([(83,211),(70,193),(60,175)],2)
    # Add a secondary thin crack.
    line([(40,66),(67,72),(95,79),(121,88),(150,94),(176,103)],2,fill=(55,53,50))
    hi=hi.filter(ImageFilter.GaussianBlur(radius=.18*scale))
    image=hi.resize((w,h),Image.Resampling.LANCZOS)
    path.parent.mkdir(parents=True,exist_ok=True)
    image.save(path,optimize=True)
    return image

def backend_reference(image:Image.Image):
    adapter=next((x for x in public_pathology_catalog() if x.meta.id==ENGINE_ID),None)
    if adapter is None:raise RuntimeError(f"{ENGINE_ID} adapter not found")
    os.environ.setdefault("SHM_UNLOAD_AFTER_INFERENCE","0")
    os.environ.setdefault("SHM_PUBLIC_YOLO_CONF",".25")
    result=adapter.predict(image)
    detections=[]
    for d in result.detections:
        detections.append({
            "label":d.label,
            "score":float(d.score),
            "box":[float(x) for x in (d.box or [])],
            "area_px":None if d.area_px is None else float(d.area_px),
        })
    return {
        "engine_id":result.engine_id,
        "status":result.status,
        "task":result.task,
        "detections":detections,
        "metrics":dict(result.metrics or {}),
    }

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--out-dir",default=str(ROOT/"browser-models"/"artifacts"/ENGINE_ID))
    a=p.parse_args()
    out=Path(a.out_dir);out.mkdir(parents=True,exist_ok=True)
    image_path=out/"parity.png";image=build_fixture(image_path)
    ref=backend_reference(image)
    if ref["status"]!="ok":raise SystemExit("Backend parity reference did not return status=ok")
    if not ref["detections"]:raise SystemExit("Parity fixture produced zero backend detections; adjust fixture before browser promotion.")
    reference={
        "schema":"shm-browser-parity-v1",
        "engine_id":ENGINE_ID,
        "fixture":"parity.png",
        "fixture_sha256":sha256(image_path),
        "image_width":image.width,
        "image_height":image.height,
        "backend":"ultralytics-pytorch-adapter",
        "confidence_threshold":.25,
        "tolerances":{
            "detection_count_delta":0,
            "top_box_iou_min":.90,
            "top_score_abs_max":.03,
            "crack_area_ratio_abs_max":.035,
        },
        "reference":ref,
    }
    ref_path=out/"parity.json"
    ref_path.write_text(json.dumps(reference,indent=2,ensure_ascii=False)+"\n",encoding="utf-8")
    print(json.dumps(reference,indent=2,ensure_ascii=False))

if __name__=="__main__":main()
