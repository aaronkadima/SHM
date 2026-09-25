#!/usr/bin/env python3
"""Export, quantize and validate CrackenPy model1 for a browser candidate.

Requires a successful evaluation.json produced by evaluate_crackenpy_candidate.py.
The concrete reference remains hold-out: road images calibrate INT8; concrete is
used only for FP32/INT8/PyTorch parity and the browser fixture.
"""
from __future__ import annotations
import argparse, hashlib, json, urllib.request
from pathlib import Path

import numpy as np
import onnx
import onnxruntime as ort
import torch
from PIL import Image
from huggingface_hub import hf_hub_download
from onnxruntime.quantization import CalibrationDataReader, CalibrationMethod, QuantFormat, QuantType, quantize_static
import segmentation_models_pytorch as smp

ROOT=Path(__file__).resolve().parents[1]
ENGINE_ID="crackenpy_public_crack"
REPO_ID="rievil/crackenpy"
MODEL_FILE="model1.pt"
CONFIG_FILE="model1.json"
LICENSE="BSD"
DOI="10.57967/hf/3295"
MEAN=np.asarray([.485,.456,.406],dtype=np.float32).reshape(1,1,3)
STD=np.asarray([.229,.224,.225],dtype=np.float32).reshape(1,1,3)

def sha256(path:Path)->str:
    h=hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda:f.read(1024*1024),b""):h.update(chunk)
    return h.hexdigest()

def download(url:str,path:Path)->Path:
    path.parent.mkdir(parents=True,exist_ok=True)
    req=urllib.request.Request(url,headers={"User-Agent":"SHM-crackenpy-export/1.0"})
    with urllib.request.urlopen(req,timeout=90) as r:path.write_bytes(r.read())
    return path

def build_model():
    cfg_path=hf_hub_download(repo_id=REPO_ID,filename=CONFIG_FILE,cache_dir="/tmp/shm-crackenpy")
    weights=hf_hub_download(repo_id=REPO_ID,filename=MODEL_FILE,cache_dir="/tmp/shm-crackenpy")
    cfg=json.loads(Path(cfg_path).read_text(encoding="utf-8"))
    encoder=cfg.get("model_type") or cfg.get("encoder_name") or "resnext50_32x4d"
    classes=int(cfg.get("num_classes",4));channels=int(cfg.get("num_channels",cfg.get("in_channels",3)))
    depth=int(cfg.get("num_encoders",5));size=int(cfg.get("image_size",416))
    model=smp.FPN(encoder_name=encoder,in_channels=channels,classes=classes,activation=None,encoder_depth=depth)
    model.load_state_dict(torch.load(weights,map_location="cpu",weights_only=True),strict=True)
    return model.eval(),cfg,size

def preprocess(image:Image.Image,size:int)->np.ndarray:
    arr=np.asarray(image.convert("RGB").resize((size,size),Image.Resampling.BILINEAR),dtype=np.float32)/255.0
    arr=(arr-MEAN)/STD
    return np.transpose(arr,(2,0,1))[None].astype(np.float32)

def gt_mask(image:Image.Image,size:int)->np.ndarray:
    raw=np.asarray(image.convert("L").resize((size,size),Image.Resampling.NEAREST),dtype=np.uint8)
    white=raw>=128
    return white if float(white.mean())<=.5 else np.logical_not(white)

def segmentation_metrics(pred,gt):
    pred=np.asarray(pred,dtype=bool);gt=np.asarray(gt,dtype=bool)
    inter=int(np.logical_and(pred,gt).sum());union=int(np.logical_or(pred,gt).sum())
    tp=inter;fp=int(np.logical_and(pred,np.logical_not(gt)).sum());fn=int(np.logical_and(np.logical_not(pred),gt).sum())
    return{
        "iou":float(1.0 if union==0 else inter/union),
        "dice":float(1.0 if (2*tp+fp+fn)==0 else (2*tp)/(2*tp+fp+fn)),
        "area_ratio":float(pred.mean()),
        "ground_truth_area_ratio":float(gt.mean()),
    }

class Reader(CalibrationDataReader):
    def __init__(self,input_name,arrays):self.input_name=input_name;self.arrays=arrays;self.i=0
    def get_next(self):
        if self.i>=len(self.arrays):return None
        x=self.arrays[self.i];self.i+=1;return{self.input_name:x}
    def rewind(self):self.i=0

def softmax_channel(logits,channel):
    x=np.asarray(logits,dtype=np.float32)
    x=x-np.max(x,axis=1,keepdims=True)
    exp=np.exp(x);prob=exp/np.maximum(exp.sum(axis=1,keepdims=True),1e-12)
    return prob[0,channel]

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--evaluation",required=True)
    p.add_argument("--out-dir",default=str(ROOT/"browser-models"/"artifacts"/ENGINE_ID))
    a=p.parse_args();out=Path(a.out_dir);out.mkdir(parents=True,exist_ok=True)
    evaluation=json.loads(Path(a.evaluation).read_text(encoding="utf-8"))
    if not evaluation.get("gate",{}).get("concrete_pass"):
        raise SystemExit("CrackenPy concrete quality gate did not pass; export blocked.")

    model,cfg,size=build_model()
    fp32=out/"model.fp32.onnx"
    torch.onnx.export(
        model,torch.randn(1,3,size,size),fp32,input_names=["images"],output_names=["logits"],
        opset_version=17,dynamic_axes={"images":{0:"batch"},"logits":{0:"batch"}}
    )
    onnx.checker.check_model(onnx.load(fp32))
    fp_session=ort.InferenceSession(str(fp32),providers=["CPUExecutionProvider"])
    input_name=fp_session.get_inputs()[0].name

    # Use six road examples from the previous evaluation exclusively for INT8 calibration.
    arrays=[]
    for case in evaluation.get("cross_domain_road",{}).get("cases",[]):
        image_file=case["image_file"]
        local=hf_hub_download(repo_id=evaluation["cross_domain_road"]["dataset"],filename=image_file,repo_type="dataset",cache_dir="/tmp/shm-crackenpy-road")
        arrays.append(preprocess(Image.open(local),size))
    if len(arrays)<3:raise SystemExit("Not enough road images for INT8 calibration.")

    int8=out/"model.int8.onnx"
    quantize_static(
        model_input=str(fp32),model_output=str(int8),
        calibration_data_reader=Reader(input_name,arrays),
        quant_format=QuantFormat.QDQ,
        activation_type=QuantType.QUInt8,weight_type=QuantType.QInt8,
        calibrate_method=CalibrationMethod.MinMax,per_channel=True,
        op_types_to_quantize=["Conv"],
        extra_options={"WeightSymmetric":True,"ActivationSymmetric":False},
    )
    onnx.checker.check_model(onnx.load(int8))
    int_session=ort.InferenceSession(str(int8),providers=["CPUExecutionProvider"])

    concrete=evaluation["concrete_reference"]
    image_path=download(concrete["image"],out/"parity.png")
    mask_path=download(concrete["mask"],out/"parity-mask.png")
    image=Image.open(image_path);x=preprocess(image,size);gt=gt_mask(Image.open(mask_path),size)
    with torch.inference_mode():pt_logits=model(torch.from_numpy(x)).cpu().numpy()
    fp_logits=np.asarray(fp_session.run(None,{input_name:x})[0],dtype=np.float32)
    int_logits=np.asarray(int_session.run(None,{int_session.get_inputs()[0].name:x})[0],dtype=np.float32)

    crack_id=2
    pt_mask=np.argmax(pt_logits,axis=1)[0]==crack_id
    fp_mask=np.argmax(fp_logits,axis=1)[0]==crack_id
    int_mask=np.argmax(int_logits,axis=1)[0]==crack_id
    fp_vs_pt=segmentation_metrics(fp_mask,pt_mask)
    int_vs_fp=segmentation_metrics(int_mask,fp_mask)
    int_quality=segmentation_metrics(int_mask,gt)
    pt_quality=segmentation_metrics(pt_mask,gt)
    fp_prob=softmax_channel(fp_logits,crack_id);int_prob=softmax_channel(int_logits,crack_id)
    prob_mae=float(np.mean(np.abs(fp_prob-int_prob)))

    gates={
        "fp32_vs_pytorch_iou_min":.995,
        "int8_vs_fp32_iou_min":.95,
        "int8_concrete_iou_min":.60,
        "int8_concrete_dice_min":.75,
        "probability_mae_max":.02,
    }
    passed=bool(
        fp_vs_pt["iou"]>=gates["fp32_vs_pytorch_iou_min"] and
        int_vs_fp["iou"]>=gates["int8_vs_fp32_iou_min"] and
        int_quality["iou"]>=gates["int8_concrete_iou_min"] and
        int_quality["dice"]>=gates["int8_concrete_dice_min"] and
        prob_mae<=gates["probability_mae_max"]
    )

    manifest={
        "schema":"shm-browser-model-v1","engine_id":ENGINE_ID,"format":"onnx",
        "file":"model.int8.onnx","sha256":sha256(int8),"bytes":int8.stat().st_size,
        "source_repo":REPO_ID,"source_file":MODEL_FILE,"source_config":CONFIG_FILE,
        "license":LICENSE,"doi":DOI,"input_size":[size,size],
        "inputs":[{"name":int_session.get_inputs()[0].name,"shape":[1,3,size,size]}],
        "outputs":[{"name":int_session.get_outputs()[0].name,"shape":list(int_session.get_outputs()[0].shape)}],
        "preprocess":{"resize":{"height":size,"width":size},"rescale_factor":1/255,
                      "image_mean":[.485,.456,.406],"image_std":[.229,.224,.225],"channel_order":"rgb_chw"},
        "labels":{"0":"background","1":"matrix","2":"crack","3":"pore"},
        "crack_id":crack_id,
        "optimization":{
            "precision":"int8","quantization":"static-qdq-minmax","weight_type":"int8","activation_type":"uint8",
            "per_channel":True,"quantized_op_types":["Conv"],"calibration_samples":len(arrays),
            "fp32_bytes":fp32.stat().st_size,"size_reduction_ratio":1-(int8.stat().st_size/max(1,fp32.stat().st_size)),
        },
        "quality":{
            "fp32_vs_pytorch":fp_vs_pt,"int8_vs_fp32":int_vs_fp,
            "pytorch_concrete":pt_quality,"int8_concrete":int_quality,
            "crack_probability_mae_fp32_vs_int8":prob_mae,"gates":gates,"passed":passed,
        },
    }
    (out/"manifest.int8.json").write_text(json.dumps(manifest,indent=2,ensure_ascii=False)+"\n",encoding="utf-8")
    parity={
        "schema":"shm-browser-parity-v1","engine_id":ENGINE_ID,"variant":"int8-qdq",
        "fixture":"parity.png","fixture_sha256":sha256(image_path),"image_width":image.width,"image_height":image.height,
        "reference_mask":"parity-mask.png","reference_mask_sha256":sha256(mask_path),
        "reference":{"crack_class_id":crack_id,"metrics":int_quality},
        "technical_parity":{"fp32_vs_pytorch":fp_vs_pt,"int8_vs_fp32":int_vs_fp,"probability_mae":prob_mae},
        "quality_gate_passed":passed,
    }
    (out/"parity.int8.json").write_text(json.dumps(parity,indent=2,ensure_ascii=False)+"\n",encoding="utf-8")
    report={
        "engine_id":ENGINE_ID,"status":"ok","passed":passed,
        "fp32_bytes":fp32.stat().st_size,"int8_bytes":int8.stat().st_size,
        "size_reduction_percent":round(100*manifest["optimization"]["size_reduction_ratio"],2),
        "fp32_vs_pytorch":fp_vs_pt,"int8_vs_fp32":int_vs_fp,
        "pytorch_concrete":pt_quality,"int8_concrete":int_quality,"probability_mae":prob_mae,
    }
    print(json.dumps(report,indent=2,ensure_ascii=False))
    if not passed:raise SystemExit("CrackenPy INT8 browser-candidate gate failed.")

if __name__=="__main__":main()
