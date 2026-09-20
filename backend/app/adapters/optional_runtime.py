from __future__ import annotations
import importlib.util,os
import numpy as np
from PIL import Image,ImageDraw
from .base import EngineAdapter,AdapterMeta,png_b64
from ..schemas import Detection,EngineResult

def _dep(pkg):
    return importlib.util.find_spec(pkg) is not None

class Detectron2Adapter(EngineAdapter):
    def __init__(self,eid,name,cfg_env,weights_env):
        self.cfg_env=cfg_env; self.weights_env=weights_env; self.predictor=None
        self.meta=AdapterMeta(eid,name,"Detectron2","instance_segmentation","Detectron2 config + checkpoint SHM.",True)
    def availability(self):
        if not _dep("detectron2"): return False,"Dependência opcional ausente: detectron2"
        c,w=os.getenv(self.cfg_env),os.getenv(self.weights_env)
        if not c or not w:return False,f"Configure {self.cfg_env} e {self.weights_env}"
        return True,None
    def _load(self):
        from detectron2.config import get_cfg
        from detectron2.engine import DefaultPredictor
        if self.predictor is None:
            c,w=os.getenv(self.cfg_env),os.getenv(self.weights_env)
            if not c or not os.path.exists(c) or not w or not os.path.exists(w): raise FileNotFoundError(f"Config/pesos inválidos: {self.cfg_env}, {self.weights_env}")
            cfg=get_cfg(); cfg.merge_from_file(c); cfg.MODEL.WEIGHTS=w; cfg.MODEL.ROI_HEADS.SCORE_THRESH_TEST=float(os.getenv("SHM_SCORE_THRESHOLD",".2"))
            self.predictor=DefaultPredictor(cfg)
        return self.predictor
    def predict(self,image):
        out=self._load()(np.asarray(image.convert("RGB"))[:,:,::-1]); inst=out["instances"].to("cpu")
        draw=image.convert("RGB").copy(); ctx=ImageDraw.Draw(draw); ds=[]
        boxes=inst.pred_boxes.tensor.numpy() if inst.has("pred_boxes") else np.empty((0,4)); scores=inst.scores.numpy() if inst.has("scores") else np.ones(len(boxes)); classes=inst.pred_classes.numpy() if inst.has("pred_classes") else np.zeros(len(boxes),int)
        masks=inst.pred_masks.numpy() if inst.has("pred_masks") else None
        for i,(b,s,c) in enumerate(zip(boxes,scores,classes)):
            box=[float(v) for v in b]; area=float(masks[i].sum()) if masks is not None else None
            ds.append(Detection(label=f"class_{int(c)}",score=float(s),box=box,area_px=area)); ctx.rectangle(box,outline=(255,70,30),width=3)
        return EngineResult(engine_id=self.meta.id,name=self.meta.name,task=self.meta.task,status="ok",detections=ds,overlay_png_base64=png_b64(draw),metrics={"detections":len(ds)})

class MMDetectionAdapter(EngineAdapter):
    def __init__(self,eid,name,cfg_env,weights_env):
        self.cfg_env=cfg_env; self.weights_env=weights_env; self.model=None
        self.meta=AdapterMeta(eid,name,"MMDetection","instance_segmentation","OpenMMLab config + checkpoint SHM.",True)
    def availability(self):
        if not _dep("mmdet"): return False,"Dependência opcional ausente: mmdet"
        c,w=os.getenv(self.cfg_env),os.getenv(self.weights_env)
        if not c or not w:return False,f"Configure {self.cfg_env} e {self.weights_env}"
        return True,None
    def _load(self):
        from mmdet.apis import init_detector
        if self.model is None:
            c,w=os.getenv(self.cfg_env),os.getenv(self.weights_env)
            if not c or not os.path.exists(c) or not w or not os.path.exists(w): raise FileNotFoundError("Config/pesos MMDetection não encontrados")
            self.model=init_detector(c,w,device=os.getenv("SHM_DEVICE","cuda:0" if _dep("torch") else "cpu"))
        return self.model
    def predict(self,image):
        from mmdet.apis import inference_detector
        sample=inference_detector(self._load(),np.asarray(image.convert("RGB"))[:,:,::-1]); p=sample.pred_instances.cpu()
        boxes=p.bboxes.numpy() if hasattr(p,"bboxes") else np.empty((0,4)); scores=p.scores.numpy() if hasattr(p,"scores") else np.ones(len(boxes)); labels=p.labels.numpy() if hasattr(p,"labels") else np.zeros(len(boxes),int)
        masks=p.masks.numpy() if hasattr(p,"masks") else None
        draw=image.convert("RGB").copy(); ctx=ImageDraw.Draw(draw); ds=[]; th=float(os.getenv("SHM_SCORE_THRESHOLD",".2"))
        for i,(b,s,c) in enumerate(zip(boxes,scores,labels)):
            if float(s)<th: continue
            box=[float(v) for v in b]; area=float(masks[i].sum()) if masks is not None else None; ds.append(Detection(label=f"class_{int(c)}",score=float(s),box=box,area_px=area)); ctx.rectangle(box,outline=(255,160,0),width=3)
        return EngineResult(engine_id=self.meta.id,name=self.meta.name,task=self.meta.task,status="ok",detections=ds,overlay_png_base64=png_b64(draw),metrics={"detections":len(ds)})

class MMSegAdapter(EngineAdapter):
    def __init__(self,eid,name,cfg_env,weights_env):
        self.cfg_env=cfg_env; self.weights_env=weights_env; self.model=None
        self.meta=AdapterMeta(eid,name,"MMSegmentation","semantic_segmentation","OpenMMLab semantic segmentation config + checkpoint SHM.",True)
    def availability(self):
        if not _dep("mmseg"): return False,"Dependência opcional ausente: mmseg"
        c,w=os.getenv(self.cfg_env),os.getenv(self.weights_env)
        if not c or not w:return False,f"Configure {self.cfg_env} e {self.weights_env}"
        return True,None
    def _load(self):
        from mmseg.apis import init_model
        if self.model is None:
            c,w=os.getenv(self.cfg_env),os.getenv(self.weights_env)
            if not c or not os.path.exists(c) or not w or not os.path.exists(w): raise FileNotFoundError("Config/pesos MMSegmentation não encontrados")
            self.model=init_model(c,w,device=os.getenv("SHM_DEVICE","cuda:0"))
        return self.model
    def predict(self,image):
        from mmseg.apis import inference_model
        sample=inference_model(self._load(),np.asarray(image.convert("RGB"))[:,:,::-1]); m=sample.pred_sem_seg.data.squeeze().cpu().numpy().astype(np.uint8)
        pal=np.array([[0,0,0],[255,70,30],[255,180,0],[180,70,20],[255,255,0],[210,210,255],[40,140,255],[180,50,220],[255,255,255]],dtype=np.uint8)
        rgb=np.asarray(image.convert("RGB")); mask=Image.fromarray(m).resize(image.size,Image.Resampling.NEAREST); mm=np.asarray(mask); tint=pal[np.mod(mm,len(pal))]; out=(.68*rgb+.32*tint).astype(np.uint8)
        ds=[]; met={}
        for i in np.unique(mm):
            if i==0: continue
            area=int((mm==i).sum()); ds.append(Detection(label=f"class_{int(i)}",area_px=float(area))); met[f"class_{int(i)}_ratio"]=round(area/mm.size,6)
        return EngineResult(engine_id=self.meta.id,name=self.meta.name,task=self.meta.task,status="ok",detections=ds,overlay_png_base64=png_b64(Image.fromarray(out)),metrics=met)

class YoloNASAdapter(EngineAdapter):
    meta=AdapterMeta("yolo_nas","YOLO-NAS","SuperGradients","detection","YOLO-NAS com checkpoint SHM.",True)
    def __init__(self): self.model=None
    def availability(self):
        if not _dep("super_gradients"):return False,"Dependência opcional ausente: super_gradients"
        if not os.getenv("SHM_YOLONAS_WEIGHTS"):return False,"Configure SHM_YOLONAS_WEIGHTS"
        return True,None
    def _load(self):
        if self.model is None:
            from super_gradients.training import models
            w=os.getenv("SHM_YOLONAS_WEIGHTS")
            if not os.path.exists(w):raise FileNotFoundError(w)
            self.model=models.get(os.getenv("SHM_YOLONAS_ARCH","yolo_nas_l"),num_classes=int(os.getenv("SHM_NUM_CLASSES","8")),checkpoint_path=w)
        return self.model
    def predict(self,image):
        pred=self._load().predict(np.asarray(image.convert("RGB")),conf=float(os.getenv("SHM_SCORE_THRESHOLD",".2")))._images_prediction_lst[0].prediction
        boxes=np.asarray(pred.bboxes_xyxy); scores=np.asarray(pred.confidence); labels=np.asarray(pred.labels)
        draw=image.convert("RGB").copy(); ctx=ImageDraw.Draw(draw); ds=[]
        for b,s,c in zip(boxes,scores,labels):
            box=[float(v) for v in b]; ds.append(Detection(label=f"class_{int(c)}",score=float(s),box=box));ctx.rectangle(box,outline=(80,170,255),width=3)
        return EngineResult(engine_id=self.meta.id,name=self.meta.name,task=self.meta.task,status="ok",detections=ds,overlay_png_base64=png_b64(draw),metrics={"detections":len(ds)})

class AnomalibAdapter(EngineAdapter):
    def __init__(self,eid,name,env):
        self.env=env; self.inferencer=None; self.meta=AdapterMeta(eid,name,"Anomalib","anomaly","Anomaly detection/localization via Anomalib checkpoint.",True)
    def availability(self):
        if not _dep("anomalib"):return False,"Dependência opcional ausente: anomalib"
        if not os.getenv(self.env):return False,"Configure "+self.env
        return True,None
    def _load(self):
        if self.inferencer is None:
            from anomalib.deploy import TorchInferencer
            p=os.getenv(self.env)
            if not os.path.exists(p):raise FileNotFoundError(p)
            self.inferencer=TorchInferencer(path=p)
        return self.inferencer
    def predict(self,image):
        p=self._load().predict(image=np.asarray(image.convert("RGB")))
        amap=getattr(p,"anomaly_map",None); score=float(getattr(p,"pred_score",0.0) or 0.0)
        if amap is None:return EngineResult(engine_id=self.meta.id,name=self.meta.name,task=self.meta.task,status="ok",metrics={"pred_score":score})
        a=np.asarray(amap).squeeze(); a=(a-a.min())/(a.max()-a.min()+1e-8); a=Image.fromarray((a*255).astype(np.uint8)).resize(image.size)
        rgb=np.asarray(image.convert("RGB"),dtype=np.float32); heat=np.zeros_like(rgb); heat[...,0]=np.asarray(a); out=np.clip(.7*rgb+.3*heat,0,255).astype(np.uint8)
        return EngineResult(engine_id=self.meta.id,name=self.meta.name,task=self.meta.task,status="ok",overlay_png_base64=png_b64(Image.fromarray(out)),metrics={"pred_score":round(score,6),"anomaly_mean":round(float(np.asarray(a).mean()/255),6)})

class GroundedSAM2Adapter(EngineAdapter):
    meta=AdapterMeta("grounded_sam2","Grounded SAM 2","Grounding DINO + SAM2","instance_segmentation","Grounding DINO encontra a patologia por texto; SAM2 refina cada caixa em máscara.",True)
    def __init__(self): self.ground=None; self.predictor=None
    def availability(self):
        if not _dep("sam2"):return False,"Dependência opcional ausente: sam2"
        if not _dep("transformers"):return False,"Dependência ausente: transformers"
        if not os.getenv("SHM_SAM2_CHECKPOINT") or not os.getenv("SHM_SAM2_CONFIG"):return False,"Configure SHM_SAM2_CHECKPOINT e SHM_SAM2_CONFIG"
        return True,None
    def _load(self):
        if self.ground is None:
            from transformers import pipeline
            self.ground=pipeline("zero-shot-object-detection",model=os.getenv("SHM_GROUNDING_MODEL","IDEA-Research/grounding-dino-tiny"),device_map="auto")
        if self.predictor is None:
            from sam2.build_sam import build_sam2
            from sam2.sam2_image_predictor import SAM2ImagePredictor
            self.predictor=SAM2ImagePredictor(build_sam2(os.getenv("SHM_SAM2_CONFIG"),os.getenv("SHM_SAM2_CHECKPOINT"),device=os.getenv("SHM_DEVICE","cuda")))
        return self.ground,self.predictor
    def predict(self,image):
        g,p=self._load(); prompts=["crack","concrete spalling","rust corrosion","exposed reinforcement bar","efflorescence","water stain","delamination"]
        raw=g(image.convert("RGB"),candidate_labels=prompts,threshold=float(os.getenv("SHM_GROUNDING_THRESHOLD",".22")))
        if not raw:return EngineResult(engine_id=self.meta.id,name=self.meta.name,task=self.meta.task,status="ok",metrics={"detections":0})
        boxes=np.array([[x["box"]["xmin"],x["box"]["ymin"],x["box"]["xmax"],x["box"]["ymax"]] for x in raw],dtype=np.float32)
        p.set_image(np.asarray(image.convert("RGB"))); masks,scores,_=p.predict(box=boxes,multimask_output=False)
        draw=np.asarray(image.convert("RGB")).copy(); ds=[]
        for i,(x,m) in enumerate(zip(raw,masks)):
            mm=np.asarray(m).squeeze().astype(bool); draw[mm]=(0.55*draw[mm]+0.45*np.array([0,220,150])).astype(np.uint8); b=boxes[i].tolist(); ds.append(Detection(label=str(x["label"]),score=float(x["score"]),box=[float(v) for v in b],area_px=float(mm.sum())))
        return EngineResult(engine_id=self.meta.id,name=self.meta.name,task=self.meta.task,status="ok",detections=ds,overlay_png_base64=png_b64(Image.fromarray(draw)),metrics={"detections":len(ds)})
