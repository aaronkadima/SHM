#!/usr/bin/env python3
"""Export compact SHM checkpoints to ONNX for ONNX Runtime Web.

Usage:
  python tools/export_browser_models.py --engine yolov8n_public_crack_seg
  python tools/export_browser_models.py --engine unet_public_crack
  python tools/export_browser_models.py --engine segformer_public_crack
"""
import argparse,hashlib,json,shutil,sys
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/"backend"))
OUTROOT=ROOT/"browser-models"/"artifacts"

SOURCE_META={
    "yolov8n_public_crack_seg":{
        "source_repo":"OpenSistemas/YOLOv8-crack-seg",
        "source_file":"yolov8n/weights/best.pt",
        "license":"AGPL-3.0",
        "input_size":[640,640],
        "postprocess":"ultralytics-yolov8-seg-v1",
    },
    "unet_public_crack":{
        "source_repo":"samir-mohamed/concrete-crack-segmentation",
        "source_file":"unet_model_weights.pth",
        "license":"MIT",
        "input_size":[256,256],
        "postprocess":"binary-mask-threshold-0.5-v1",
    },
    "segformer_public_crack":{
        "source_repo":"onebeans/segformer_crack_detection",
        "source_file":"model.safetensors",
        "license":"MIT",
        "input_size":[512,512],
        "postprocess":"segformer-softmax-crack-v1",
    },
}

def _dims(value):
    out=[]
    for dim in value.type.tensor_type.shape.dim:
        if dim.dim_value:out.append(int(dim.dim_value))
        elif dim.dim_param:out.append(dim.dim_param)
        else:out.append(None)
    return out

def _sha256(path):
    h=hashlib.sha256()
    with Path(path).open("rb") as f:
        for chunk in iter(lambda:f.read(1024*1024),b""):h.update(chunk)
    return h.hexdigest()

def runtime_metadata(engine):
    if engine=="unet_public_crack":
        return {
            "preprocess":{
                "resize":{"height":256,"width":256},
                "rescale_factor":1/255,
                "image_mean":[.485,.456,.406],
                "image_std":[.229,.224,.225],
                "channel_order":"rgb_chw"
            },
            "threshold":.50,
            "labels":{"0":"background","1":"crack"},
            "crack_id":1,
        }
    if engine=="segformer_public_crack":
        from transformers import AutoConfig,AutoImageProcessor
        processor=AutoImageProcessor.from_pretrained("onebeans/segformer_crack_detection")
        config=AutoConfig.from_pretrained("onebeans/segformer_crack_detection")
        size=dict(getattr(processor,"size",{}) or {})
        labels={str(k):str(v) for k,v in (getattr(config,"id2label",{}) or {}).items()}
        crack_id=next((int(k) for k,v in labels.items() if "crack" in v.lower()),1)
        return {
            "preprocess":{
                "resize":size,
                "rescale_factor":float(getattr(processor,"rescale_factor",1/255)),
                "image_mean":[float(x) for x in getattr(processor,"image_mean",[.485,.456,.406])],
                "image_std":[float(x) for x in getattr(processor,"image_std",[.229,.224,.225])],
                "channel_order":"rgb_chw"
            },
            "threshold":.50,
            "labels":labels,
            "crack_id":crack_id,
        }
    if engine=="yolov8n_public_crack_seg":
        return {
            "preprocess":{"letterbox":{"height":640,"width":640},"rescale_factor":1/255,"channel_order":"rgb_chw"},
            "threshold":.25,
            "labels":{"0":"crack"},
            "crack_id":0,
        }
    return {}

def write_manifest(engine,out):
    import onnx
    model=onnx.load(out)
    onnx.checker.check_model(model)
    manifest={
        "schema":"shm-browser-model-v1",
        "engine_id":engine,
        "format":"onnx",
        "opset":max((int(x.version) for x in model.opset_import),default=None),
        "sha256":_sha256(out),
        "bytes":Path(out).stat().st_size,
        "file":"model.onnx",
        "inputs":[{"name":x.name,"shape":_dims(x)} for x in model.graph.input],
        "outputs":[{"name":x.name,"shape":_dims(x)} for x in model.graph.output],
        **SOURCE_META[engine],
        **runtime_metadata(engine),
    }
    target=Path(out).with_name("manifest.json")
    target.write_text(json.dumps(manifest,indent=2,ensure_ascii=False)+"\n",encoding="utf-8")
    return target,manifest

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
    choices=["yolov8n_public_crack_seg","unet_public_crack","segformer_public_crack"]
    p=argparse.ArgumentParser();p.add_argument("--engine",required=True,choices=choices)
    a=p.parse_args();OUTROOT.mkdir(parents=True,exist_ok=True)
    out={"yolov8n_public_crack_seg":yolo,"unet_public_crack":unet,"segformer_public_crack":segformer}[a.engine]()
    manifest_path,manifest=write_manifest(a.engine,out)
    print(json.dumps({"model":str(out),"manifest":str(manifest_path),"manifest_data":manifest},indent=2,ensure_ascii=False))

if __name__=="__main__":main()
