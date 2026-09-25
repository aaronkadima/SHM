#!/usr/bin/env python3
"""Create and validate an INT8 QDQ browser candidate for the public U-Net crack model.

The original FP32 ONNX remains untouched. This script:
1) downloads a CC BY 4.0 concrete-crack visualization grid;
2) creates deterministic calibration and hold-out crops;
3) statically quantizes Conv operators to INT8 QDQ;
4) compares INT8 and FP32 outputs on hold-out crops;
5) creates a real-image backend parity fixture/reference for browser CI.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import urllib.request
from pathlib import Path

import numpy as np
import onnxruntime as ort
from PIL import Image
from onnxruntime.quantization import (
    CalibrationDataReader,
    CalibrationMethod,
    QuantFormat,
    QuantType,
    quantize_static,
)

ROOT=Path(__file__).resolve().parents[1]
ENGINE_ID="unet_public_crack"
CAL_URL=(
    "https://raw.githubusercontent.com/dataset-ninja/"
    "concrete-crack-segmentation-dataset/main/visualizations/horizontal_grid.png"
)
CAL_LICENSE="CC BY 4.0"
CAL_ATTRIBUTION="Dataset Ninja · Concrete Crack Segmentation Dataset"
PARITY_URL="https://raw.githubusercontent.com/amirrezaie1415/Concrete-Crack-Segmentation/master/docs/imgs/254_768_0.png"
PARITY_LICENSE="CC BY 4.0 (source dataset)"
PARITY_ATTRIBUTION="Concrete Crack Segmentation Dataset · Özgenel (2019); sample used by Rezaie et al. (2020)"
MEAN=np.asarray([.485,.456,.406],dtype=np.float32).reshape(1,1,3)
STD=np.asarray([.229,.224,.225],dtype=np.float32).reshape(1,1,3)


def sha256(path:Path)->str:
    h=hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda:f.read(1024*1024),b""):
            h.update(chunk)
    return h.hexdigest()


def download_source(path:Path,url:str=CAL_URL)->Path:
    path.parent.mkdir(parents=True,exist_ok=True)
    req=urllib.request.Request(url,headers={"User-Agent":"SHM-browser-model-export/1.0"})
    with urllib.request.urlopen(req,timeout=60) as response:
        path.write_bytes(response.read())
    return path


def crop_grid(image:Image.Image,cols=5,rows=4):
    rgb=image.convert("RGB")
    crops=[]
    for row in range(rows):
        y1=round(row*rgb.height/rows);y2=round((row+1)*rgb.height/rows)
        for col in range(cols):
            x1=round(col*rgb.width/cols);x2=round((col+1)*rgb.width/cols)
            crops.append(rgb.crop((x1,y1,x2,y2)))
    return crops


def preprocess(image:Image.Image)->np.ndarray:
    img=image.convert("RGB").resize((256,256),Image.Resampling.LANCZOS)
    arr=np.asarray(img,dtype=np.float32)/255.0
    arr=(arr-MEAN)/STD
    return np.transpose(arr,(2,0,1))[None].astype(np.float32)


class Reader(CalibrationDataReader):
    def __init__(self,input_name:str,items:list[np.ndarray]):
        self.input_name=input_name
        self.items=items
        self.index=0
    def get_next(self):
        if self.index>=len(self.items):
            return None
        value=self.items[self.index]
        self.index+=1
        return {self.input_name:value}
    def rewind(self):
        self.index=0


def compare_models(fp32:Path,int8:Path,holdout:list[np.ndarray]):
    a=ort.InferenceSession(str(fp32),providers=["CPUExecutionProvider"])
    b=ort.InferenceSession(str(int8),providers=["CPUExecutionProvider"])
    ia=a.get_inputs()[0].name;ib=b.get_inputs()[0].name
    rows=[]
    for idx,x in enumerate(holdout):
        pa=np.asarray(a.run(None,{ia:x})[0],dtype=np.float32)
        pb=np.asarray(b.run(None,{ib:x})[0],dtype=np.float32)
        diff=np.abs(pa-pb)
        ma=pa>=.5;mb=pb>=.5
        inter=int(np.logical_and(ma,mb).sum());union=int(np.logical_or(ma,mb).sum())
        iou=1.0 if union==0 else inter/union
        area_a=float(ma.mean());area_b=float(mb.mean())
        rows.append({
            "index":idx,
            "mean_abs_error":float(diff.mean()),
            "max_abs_error":float(diff.max()),
            "binary_iou":float(iou),
            "fp32_area_ratio":area_a,
            "int8_area_ratio":area_b,
            "area_ratio_abs_delta":abs(area_a-area_b),
        })
    summary={
        "holdout_count":len(rows),
        "mean_abs_error":float(np.mean([x["mean_abs_error"] for x in rows])),
        "max_abs_error":float(np.max([x["max_abs_error"] for x in rows])),
        "mean_binary_iou":float(np.mean([x["binary_iou"] for x in rows])),
        "min_binary_iou":float(np.min([x["binary_iou"] for x in rows])),
        "max_area_ratio_abs_delta":float(np.max([x["area_ratio_abs_delta"] for x in rows])),
        "cases":rows,
    }
    return summary


def backend_reference(image:Image.Image,parity_path:Path):
    os.environ.setdefault("SHM_COMPACT_MODEL_CACHE","/tmp/shm-compact-model-cache")
    os.environ.setdefault("SHM_UNLOAD_AFTER_INFERENCE","0")
    sys.path.insert(0,str(ROOT/"backend"))
    from app.adapters.hf_pathology_adapters import public_pathology_catalog

    adapter=next((x for x in public_pathology_catalog() if x.meta.id==ENGINE_ID),None)
    if adapter is None:
        raise RuntimeError(f"{ENGINE_ID} adapter not found")

    chosen=image.convert("RGB")
    result=adapter.predict(chosen)
    metrics=dict(result.metrics or {})
    ratio=float(metrics.get("crack_area_ratio",0.0))
    quality_gate={
        "passed":bool(0.0005<ratio<0.90),
        "metric":"crack_area_ratio",
        "value":ratio,
        "min_exclusive":0.0005,
        "max_exclusive":0.90,
        "reason":None if 0.0005<ratio<0.90 else "Checkpoint saturates or collapses on an external real concrete-crack image."
    }

    parity_path.parent.mkdir(parents=True,exist_ok=True)
    chosen.save(parity_path,optimize=True)
    detections=[]
    for d in result.detections:
        detections.append({
            "label":d.label,
            "score":float(d.score),
            "box":[float(v) for v in (d.box or [])],
            "area_px":None if d.area_px is None else float(d.area_px),
        })
    return {
        "engine_id":result.engine_id,
        "status":result.status,
        "task":result.task,
        "detections":detections,
        "metrics":metrics,
    },quality_gate


def main():
    p=argparse.ArgumentParser()
    p.add_argument("--dir",default=str(ROOT/"browser-models"/"artifacts"/ENGINE_ID))
    a=p.parse_args()
    outdir=Path(a.dir)
    fp32=outdir/"model.onnx"
    base_manifest_path=outdir/"manifest.json"
    if not fp32.exists() or not base_manifest_path.exists():
        raise SystemExit("Export the FP32 U-Net model before optimizing it.")

    source=download_source(outdir/"calibration-source.png")
    crops=crop_grid(Image.open(source),5,4)
    # Deterministic split: 12 calibration crops, 8 hold-out crops.
    calibration=[preprocess(img) for i,img in enumerate(crops) if i%5 not in {1,4}]
    holdout_images=[img for i,img in enumerate(crops) if i%5 in {1,4}]
    holdout=[preprocess(img) for img in holdout_images]

    session=ort.InferenceSession(str(fp32),providers=["CPUExecutionProvider"])
    input_name=session.get_inputs()[0].name
    int8=outdir/"model.int8.onnx"
    quantize_static(
        model_input=str(fp32),
        model_output=str(int8),
        calibration_data_reader=Reader(input_name,calibration),
        quant_format=QuantFormat.QDQ,
        activation_type=QuantType.QUInt8,
        weight_type=QuantType.QInt8,
        calibrate_method=CalibrationMethod.MinMax,
        per_channel=True,
        op_types_to_quantize=["Conv"],
        extra_options={"WeightSymmetric":True,"ActivationSymmetric":False},
    )

    # Hard validation before publishing the candidate.
    candidate=ort.InferenceSession(str(int8),providers=["CPUExecutionProvider"])
    test=candidate.run(None,{candidate.get_inputs()[0].name:holdout[0]})
    if not test or not np.isfinite(np.asarray(test[0])).all():
        raise SystemExit("INT8 model failed ONNX Runtime CPU validation.")

    consistency=compare_models(fp32,int8,holdout)
    if consistency["mean_abs_error"]>.02:
        raise SystemExit("INT8 mean absolute error exceeded 0.02")
    if consistency["mean_binary_iou"]<.95:
        raise SystemExit("INT8 mean binary IoU dropped below 0.95")
    if consistency["max_area_ratio_abs_delta"]>.03:
        raise SystemExit("INT8 area-ratio delta exceeded 0.03")

    base=json.loads(base_manifest_path.read_text(encoding="utf-8"))
    manifest={
        **base,
        "sha256":sha256(int8),
        "bytes":int8.stat().st_size,
        "file":"model.int8.onnx",
        "optimization":{
            "precision":"int8",
            "quantization":"static-qdq-minmax",
            "activation_type":"uint8",
            "weight_type":"int8",
            "per_channel":True,
            "quantized_op_types":["Conv"],
            "calibration_samples":len(calibration),
            "holdout_samples":len(holdout),
            "calibration_source":CAL_URL,
            "calibration_source_license":CAL_LICENSE,
            "calibration_source_attribution":CAL_ATTRIBUTION,
            "fp32_sha256":base.get("sha256"),
            "fp32_bytes":base.get("bytes"),
            "size_reduction_ratio":1-(int8.stat().st_size/max(1,int(base.get("bytes",1)))),
            "consistency":consistency,
        },
    }
    int8_manifest=outdir/"manifest.int8.json"
    int8_manifest.write_text(json.dumps(manifest,indent=2,ensure_ascii=False)+"\n",encoding="utf-8")

    parity_path=outdir/"parity.int8.png"
    parity_source=download_source(outdir/"parity-source.png",PARITY_URL)
    reference,quality_gate=backend_reference(Image.open(parity_source),parity_path)
    parity={
        "schema":"shm-browser-parity-v1",
        "engine_id":ENGINE_ID,
        "variant":"int8-qdq",
        "fixture":"parity.int8.png",
        "fixture_sha256":sha256(parity_path),
        "image_width":Image.open(parity_path).width,
        "image_height":Image.open(parity_path).height,
        "fixture_source":PARITY_URL,
        "fixture_source_license":PARITY_LICENSE,
        "fixture_source_attribution":PARITY_ATTRIBUTION,
        "backend":"pytorch-unet-adapter",
        "threshold":.5,
        "tolerances":{
            "detection_count_delta":0,
            "score_abs_max":.08,
            "crack_area_ratio_abs_max":.03,
            "mean_probability_abs_max":.04,
            "max_probability_abs_max":.08,
        },
        "quantization_consistency":consistency,
        "quality_gate":quality_gate,
        "reference":reference,
    }
    parity_json=outdir/"parity.int8.json"
    parity_json.write_text(json.dumps(parity,indent=2,ensure_ascii=False)+"\n",encoding="utf-8")

    print(json.dumps({
        "engine":ENGINE_ID,
        "status":"ok",
        "fp32_bytes":fp32.stat().st_size,
        "int8_bytes":int8.stat().st_size,
        "size_reduction_percent":round(100*manifest["optimization"]["size_reduction_ratio"],2),
        "consistency":{k:v for k,v in consistency.items() if k!="cases"},
        "parity_reference":{
            "detections":len(reference.get("detections",[])),
            "metrics":reference.get("metrics",{}),
        },
        "quality_gate":quality_gate,
        "assets":{
            "model":str(int8),
            "manifest":str(int8_manifest),
            "parity_png":str(parity_path),
            "parity_json":str(parity_json),
        },
    },indent=2,ensure_ascii=False))


if __name__=="__main__":
    main()
