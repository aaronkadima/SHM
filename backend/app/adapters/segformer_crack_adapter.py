from __future__ import annotations
import gc,os
import numpy as np
import torch
import torch.nn.functional as F
from PIL import Image
from .base import EngineAdapter,AdapterMeta,png_b64
from ..schemas import Detection,EngineResult

MODEL_ID=os.getenv("SHM_SEGFORMER_CRACK_MODEL","onebeans/segformer_crack_detection")
CACHE_DIR=os.getenv("SHM_COMPACT_MODEL_CACHE","/models/compact")

def _truthy(name,default="1"):
    return os.getenv(name,default).lower() in {"1","true","yes","on"}

class SegFormerCrackAdapter(EngineAdapter):
    meta=AdapterMeta(
        "segformer_public_crack",
        "SegFormer-B0 Crack Segmentation (public)",
        "Transformers / Hugging Face",
        "semantic_segmentation",
        "SegFormer-B0 compacto treinado para segmentação de fissuras, adicionando uma arquitetura Transformer à comparação.",
        False,False,"public_shm_checkpoint",
        "https://huggingface.co/onebeans/segformer_crack_detection","MIT"
    )
    def __init__(self):
        self.processor=None;self.model=None;self.crack_id=None
    def availability(self):
        return True,None
    def _load(self):
        if self.model is None:
            from transformers import AutoImageProcessor,SegformerForSemanticSegmentation
            self.processor=AutoImageProcessor.from_pretrained(MODEL_ID,cache_dir=CACHE_DIR)
            self.model=SegformerForSemanticSegmentation.from_pretrained(MODEL_ID,cache_dir=CACHE_DIR).eval()
            labels={int(k):str(v) for k,v in (self.model.config.id2label or {}).items()}
            self.crack_id=next((i for i,label in labels.items() if "crack" in label.lower()),1)
        return self.processor,self.model
    def _release(self):
        if _truthy("SHM_UNLOAD_AFTER_INFERENCE","1"):
            self.processor=None;self.model=None;self.crack_id=None;gc.collect()
    def predict(self,image):
        try:
            src=image.convert("RGB");proc,model=self._load()
            inputs=proc(images=src,return_tensors="pt")
            with torch.inference_mode():
                logits=model(**inputs).logits
                logits=F.interpolate(logits,size=(src.height,src.width),mode="bilinear",align_corners=False)
                probs=torch.softmax(logits,dim=1)[0]
            cid=int(self.crack_id if self.crack_id is not None else 1)
            cid=max(0,min(cid,probs.shape[0]-1))
            crack_prob=probs[cid].cpu().numpy()
            labels=probs.argmax(dim=0).cpu().numpy()
            threshold=float(os.getenv("SHM_SEGFORMER_CRACK_THRESHOLD",".50"))
            mask=(labels==cid)&(crack_prob>=threshold)
            rgb=np.asarray(src,dtype=np.float32);out=rgb.copy()
            out[mask]=.58*rgb[mask]+.42*np.array([255,45,35],dtype=np.float32)
            area=int(mask.sum());ratio=area/mask.size
            ds=[]
            if area:
                ds.append(Detection(
                    label="crack",
                    score=float(crack_prob[mask].mean()),
                    area_px=float(area)
                ))
            return EngineResult(
                engine_id=self.meta.id,name=self.meta.name,task=self.meta.task,status="ok",
                detections=ds,
                overlay_png_base64=png_b64(Image.fromarray(np.clip(out,0,255).astype(np.uint8))),
                metrics={
                    "crack_area_ratio":round(float(ratio),6),
                    "mean_crack_probability":round(float(crack_prob.mean()),6),
                    "max_crack_probability":round(float(crack_prob.max()),6),
                    "threshold":threshold,
                    "source_repo":MODEL_ID
                }
            )
        finally:
            self._release()
