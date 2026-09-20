#!/usr/bin/env python3
"""Exporta checkpoints compactos SHM para ONNX visando ONNX Runtime Web.

Uso:
  python tools/export_browser_models.py --engine yolov8n_public_crack_seg
  python tools/export_browser_models.py --engine unet_public_crack
  python tools/export_browser_models.py --engine segformer_public_crack
"""
import argparse,shutil,sys
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/"backend"))
OUTROOT=ROOT/"browser-models"/"artifacts"

def yolo():
    from huggingface_hub import hf_hub_download
    from ultralytics import YOLO
    src=hf_hub_download(repo_id="OpenSistemas/YOLOv8-crack-seg",filename="yolov8n/weights/best.pt")
    model=YOLO(src)
    exported=Path(model.export(format="onnx",imgsz=640,opset=17,simplify=True,dynamic=False))
    out=OUTROOT/"yolov8n_public_crack_seg"/"model.onnx";out.parent.mkdir(parents=True,exist_ok=True)
    shutil.copy2(exported,out);return out

def unet():
    import torch
    from huggingface_hub import hf_hub_download
    from app.adapters.hf_pathology_adapters import ImprovedUNet
    src=hf_hub_download(repo_id="samir-mohamed/concrete-crack-segmentation",filename="unet_model_weights.pth")
    model=ImprovedUNet(3,1,4,64).eval()
    model.load_state_dict(torch.load(src,map_location="cpu",weights_only=True),strict=True)
    out=OUTROOT/"unet_public_crack"/"model.onnx";out.parent.mkdir(parents=True,exist_ok=True)
    torch.onnx.export(model,torch.randn(1,3,256,256),out,input_names=["images"],output_names=["mask"],opset_version=17,
        dynamic_axes={"images":{0:"batch"},"mask":{0:"batch"}})
    return out

def segformer():
    import torch
    from transformers import SegformerForSemanticSegmentation
    model=SegformerForSemanticSegmentation.from_pretrained("onebeans/segformer_crack_detection").eval()
    class Wrapper(torch.nn.Module):
        def __init__(self,m):super().__init__();self.m=m
        def forward(self,pixel_values):return self.m(pixel_values=pixel_values).logits
    wrapped=Wrapper(model).eval()
    out=OUTROOT/"segformer_public_crack"/"model.onnx";out.parent.mkdir(parents=True,exist_ok=True)
    torch.onnx.export(wrapped,torch.randn(1,3,512,512),out,input_names=["pixel_values"],output_names=["logits"],
        opset_version=17,dynamic_axes={"pixel_values":{0:"batch",2:"height",3:"width"},"logits":{0:"batch",2:"out_height",3:"out_width"}})
    return out

def main():
    p=argparse.ArgumentParser();p.add_argument("--engine",required=True,choices=["yolov8n_public_crack_seg","unet_public_crack","segformer_public_crack"])
    a=p.parse_args();OUTROOT.mkdir(parents=True,exist_ok=True)
    out={"yolov8n_public_crack_seg":yolo,"unet_public_crack":unet,"segformer_public_crack":segformer}[a.engine]()
    print(out)

if __name__=="__main__":main()
