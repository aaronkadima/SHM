#!/usr/bin/env python3
"""Validate an exported SHM browser ONNX artifact and its manifest."""
import argparse,hashlib,json
from pathlib import Path
import numpy as np
import onnx
import onnxruntime as ort

DEFAULT_SHAPES={
    "yolov8n_public_crack_seg":[1,3,640,640],
    "unet_public_crack":[1,3,256,256],
    "segformer_public_crack":[1,3,512,512],
}

def sha256(path:Path):
    h=hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda:f.read(1024*1024),b""):h.update(chunk)
    return h.hexdigest()

def resolve_shape(meta,fallback):
    shape=[]
    for i,dim in enumerate(meta.shape):
        if isinstance(dim,int) and dim>0:shape.append(dim)
        else:shape.append(fallback[i] if i<len(fallback) else 1)
    return shape

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--engine",required=True,choices=sorted(DEFAULT_SHAPES))
    p.add_argument("--dir",default=None)
    a=p.parse_args()
    root=Path(a.dir) if a.dir else Path("browser-models/artifacts")/a.engine
    model_path=root/"model.onnx";manifest_path=root/"manifest.json"
    if not model_path.exists() or not manifest_path.exists():raise SystemExit("Missing model.onnx or manifest.json in "+str(root))

    model=onnx.load(model_path)
    onnx.checker.check_model(model)
    manifest=json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("engine_id")!=a.engine:raise SystemExit("Manifest engine_id mismatch")
    if manifest.get("sha256")!=sha256(model_path):raise SystemExit("Manifest SHA-256 mismatch")
    if manifest.get("bytes")!=model_path.stat().st_size:raise SystemExit("Manifest size mismatch")

    session=ort.InferenceSession(str(model_path),providers=["CPUExecutionProvider"])
    if not session.get_inputs():raise SystemExit("ONNX model has no inputs")
    input_meta=session.get_inputs()[0]
    shape=resolve_shape(input_meta,DEFAULT_SHAPES[a.engine])
    x=np.random.default_rng(26092026).normal(0,1,size=shape).astype(np.float32)
    outputs=session.run(None,{input_meta.name:x})
    if not outputs:raise SystemExit("ONNX Runtime returned no outputs")
    for idx,out in enumerate(outputs):
        arr=np.asarray(out)
        if arr.size==0:raise SystemExit(f"Output {idx} is empty")
        if not np.isfinite(arr).all():raise SystemExit(f"Output {idx} contains non-finite values")
    print(json.dumps({
        "engine":a.engine,
        "status":"ok",
        "input":{"name":input_meta.name,"shape":shape},
        "outputs":[{"name":meta.name,"shape":list(np.asarray(value).shape)} for meta,value in zip(session.get_outputs(),outputs)],
        "sha256":manifest["sha256"],
        "bytes":manifest["bytes"],
    },indent=2))

if __name__=="__main__":main()
