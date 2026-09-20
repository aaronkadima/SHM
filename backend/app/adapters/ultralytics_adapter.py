import os,numpy as np
from PIL import ImageDraw
from .base import EngineAdapter,AdapterMeta,png_b64
from ..schemas import Detection,EngineResult
class UltralyticsAdapter(EngineAdapter):
    def __init__(self,eid,name,env,default):
        self.env=env; self.default=default; self._model=None
        self.meta=AdapterMeta(eid,name,"Ultralytics","detection","Use checkpoint SHM próprio para comparação supervisionada.")
    def _load(self):
        from ultralytics import YOLO,RTDETR
        if self._model is None:
            w=os.getenv(self.env,self.default); self._model=RTDETR(w) if self.meta.id=="rtdetr" else YOLO(w)
        return self._model
    def predict(self,image):
        r=self._load().predict(np.asarray(image.convert("RGB")),verbose=False,conf=.20)[0]
        draw=image.convert("RGB").copy(); ctx=ImageDraw.Draw(draw); ds=[]
        if r.boxes is not None:
            bs=r.boxes.xyxy.cpu().numpy(); cs=r.boxes.conf.cpu().numpy(); ids=r.boxes.cls.cpu().numpy().astype(int)
            for b,s,c in zip(bs,cs,ids):
                box=[float(v) for v in b]; label=str(r.names.get(int(c),c))
                ds.append(Detection(label=label,score=float(s),box=box)); ctx.rectangle(box,outline=(255,70,30),width=3); ctx.text((box[0]+3,box[1]+3),f"{label} {s:.2f}",fill=(255,255,0))
        return EngineResult(engine_id=self.meta.id,name=self.meta.name,task=self.meta.task,status="ok",detections=ds,overlay_png_base64=png_b64(draw),metrics={"detections":len(ds),"checkpoint":os.getenv(self.env,self.default)})
