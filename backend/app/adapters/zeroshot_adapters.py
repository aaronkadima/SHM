from __future__ import annotations
import importlib.util, os
import numpy as np
import torch
from PIL import Image, ImageDraw
from .base import EngineAdapter, AdapterMeta, png_b64
from ..schemas import Detection, EngineResult

PATHOLOGY_PROMPTS=[
    "crack",
    "concrete spalling",
    "rust corrosion",
    "exposed reinforcement bar",
    "efflorescence",
    "water stain",
    "delamination",
    "concrete damage",
]

PALETTE=np.array([
    [255,70,30],[255,170,0],[180,70,20],[255,230,0],
    [210,210,255],[40,140,255],[180,50,220],[255,255,255]
],dtype=np.uint8)

class OWLv2Adapter(EngineAdapter):
    meta=AdapterMeta(
        "owlv2","OWLv2","Transformers","open_vocabulary",
        "Detecção zero-shot por texto; útil como segundo motor independente para comparar com Grounding DINO.",
        False,True,"zero_shot"
    )
    def __init__(self): self.pipe=None
    def availability(self):
        return (importlib.util.find_spec("transformers") is not None,
                None if importlib.util.find_spec("transformers") else "Dependência ausente: transformers")
    def _load(self):
        if self.pipe is None:
            from transformers import pipeline
            self.pipe=pipeline(
                "zero-shot-object-detection",
                model=os.getenv("SHM_OWLV2_MODEL","google/owlv2-base-patch16-ensemble"),
                device=-1
            )
        return self.pipe
    def predict(self,image):
        threshold=float(os.getenv("SHM_OWLV2_THRESHOLD",".10"))
        raw=self._load()(image.convert("RGB"),candidate_labels=PATHOLOGY_PROMPTS,threshold=threshold)
        draw=image.convert("RGB").copy(); ctx=ImageDraw.Draw(draw); ds=[]
        for x in raw:
            b=x["box"]; box=[float(b["xmin"]),float(b["ymin"]),float(b["xmax"]),float(b["ymax"])]
            label=str(x["label"]); score=float(x["score"])
            ds.append(Detection(label=label,score=score,box=box))
            ctx.rectangle(box,outline=(90,170,255),width=3)
            ctx.text((box[0]+3,box[1]+3),f"{label} {score:.2f}",fill=(255,255,0))
        return EngineResult(
            engine_id=self.meta.id,name=self.meta.name,task=self.meta.task,status="ok",
            detections=ds,overlay_png_base64=png_b64(draw),
            metrics={"detections":len(ds),"threshold":threshold,"mode":"zero-shot"}
        )

class CLIPSegAdapter(EngineAdapter):
    meta=AdapterMeta(
        "clipseg","CLIPSeg","Transformers","semantic_segmentation",
        "Segmentação zero-shot guiada por texto para localizar manifestações patológicas sem checkpoint SHM específico.",
        False,True,"zero_shot"
    )
    def __init__(self):
        self.processor=None; self.model=None
    def availability(self):
        ok=importlib.util.find_spec("transformers") is not None
        return ok,None if ok else "Dependência ausente: transformers"
    def _load(self):
        if self.model is None:
            from transformers import CLIPSegProcessor,CLIPSegForImageSegmentation
            model_id=os.getenv("SHM_CLIPSEG_MODEL","CIDAS/clipseg-rd64-refined")
            self.processor=CLIPSegProcessor.from_pretrained(model_id)
            self.model=CLIPSegForImageSegmentation.from_pretrained(model_id).eval()
        return self.processor,self.model
    def predict(self,image):
        proc,model=self._load()
        prompts=PATHOLOGY_PROMPTS
        images=[image.convert("RGB") for _ in prompts]
        inputs=proc(text=prompts,images=images,padding=True,return_tensors="pt")
        with torch.inference_mode():
            logits=model(**inputs).logits
        probs=torch.sigmoid(logits).cpu().numpy()
        if probs.ndim==2: probs=probs[None,...]
        threshold=float(os.getenv("SHM_CLIPSEG_THRESHOLD",".55"))
        h,w=image.height,image.width
        resized=[]
        for p in probs:
            pi=Image.fromarray((np.clip(p,0,1)*255).astype(np.uint8)).resize((w,h),Image.Resampling.BILINEAR)
            resized.append(np.asarray(pi,dtype=np.float32)/255.0)
        stack=np.stack(resized,axis=0)
        best_idx=stack.argmax(axis=0); best_prob=stack.max(axis=0)
        active=best_prob>=threshold
        rgb=np.asarray(image.convert("RGB"),dtype=np.float32)
        tint=np.zeros_like(rgb,dtype=np.float32)
        for i in range(len(prompts)):
            tint[(best_idx==i)&active]=PALETTE[i]
        out=rgb.copy()
        out[active]=0.62*rgb[active]+0.38*tint[active]
        detections=[]; metrics={"threshold":threshold,"mode":"zero-shot"}
        for i,label in enumerate(prompts):
            m=(best_idx==i)&active
            area=int(m.sum())
            ratio=area/(w*h)
            metrics[label.replace(" ","_")+"_ratio"]=round(ratio,6)
            if area:
                detections.append(Detection(label=label,score=float(stack[i][m].mean()),area_px=float(area)))
        return EngineResult(
            engine_id=self.meta.id,name=self.meta.name,task=self.meta.task,status="ok",
            detections=detections,overlay_png_base64=png_b64(Image.fromarray(np.clip(out,0,255).astype(np.uint8))),
            metrics=metrics
        )
