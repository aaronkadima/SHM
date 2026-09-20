import os
from PIL import ImageDraw
from .base import EngineAdapter,AdapterMeta,png_b64
from ..schemas import Detection,EngineResult
PROMPTS=["crack","concrete spalling","rust corrosion","exposed reinforcement bar","efflorescence","water stain","delamination","concrete damage"]
class GroundingDINOAdapter(EngineAdapter):
    meta=AdapterMeta("grounding_dino","Grounding DINO","Transformers","open_vocabulary","Detecção zero-shot por prompts de manifestações patológicas.")
    def __init__(self): self.pipe=None
    def availability(self):
        enabled=os.getenv("SHM_ENABLE_HEAVY_ZEROSHOT","0").lower() in {"1","true","yes"}
        return enabled,None if enabled else "Desativado no perfil cloud compacto; requer mais armazenamento/RAM (SHM_ENABLE_HEAVY_ZEROSHOT=1)."
    def _load(self):
        from transformers import pipeline
        if self.pipe is None:
            self.pipe=pipeline("zero-shot-object-detection",model=os.getenv("SHM_GROUNDING_MODEL","IDEA-Research/grounding-dino-tiny"),device=-1)
        return self.pipe
    def predict(self,image):
        raw=self._load()(image.convert("RGB"),candidate_labels=PROMPTS,threshold=float(os.getenv("SHM_GROUNDING_THRESHOLD",".22")))
        draw=image.convert("RGB").copy(); ctx=ImageDraw.Draw(draw); ds=[]
        for x in raw:
            b=x["box"]; box=[float(b["xmin"]),float(b["ymin"]),float(b["xmax"]),float(b["ymax"])]; label=str(x["label"]); s=float(x["score"])
            ds.append(Detection(label=label,score=s,box=box)); ctx.rectangle(box,outline=(25,220,150),width=3); ctx.text((box[0]+3,box[1]+3),f"{label} {s:.2f}",fill=(255,255,0))
        return EngineResult(engine_id=self.meta.id,name=self.meta.name,task=self.meta.task,status="ok",detections=ds,overlay_png_base64=png_b64(draw),metrics={"detections":len(ds),"prompt_count":len(PROMPTS)})
