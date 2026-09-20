from __future__ import annotations
import gc,os
import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
from PIL import Image
from huggingface_hub import hf_hub_download
from .base import EngineAdapter,AdapterMeta,png_b64
from ..schemas import Detection,EngineResult

CACHE_DIR=os.getenv("SHM_COMPACT_MODEL_CACHE","/models/compact")

def _truthy(name,default="1"):
    return os.getenv(name,default).lower() in {"1","true","yes","on"}

class HFUltralyticsAdapter(EngineAdapter):
    def __init__(self,eid,name,repo_id,filename,task,description,license_name,source_url,conf_env="SHM_PUBLIC_YOLO_CONF",default_conf=".25",imgsz=None):
        self.repo_id=repo_id;self.filename=filename;self.model=None;self.conf_env=conf_env;self.default_conf=default_conf;self.imgsz=imgsz
        self.meta=AdapterMeta(eid,name,"Ultralytics / Hugging Face",task,description,False,True,"public_shm_checkpoint",source_url,license_name)
    def availability(self): return True,None
    def _load(self):
        if self.model is None:
            from ultralytics import YOLO
            path=hf_hub_download(repo_id=self.repo_id,filename=self.filename,cache_dir=CACHE_DIR)
            self.model=YOLO(path)
        return self.model
    def _release(self):
        if _truthy("SHM_UNLOAD_AFTER_INFERENCE","1"):
            self.model=None
            gc.collect()
    def predict(self,image):
        conf=float(os.getenv(self.conf_env,self.default_conf))
        kwargs={"verbose":False,"conf":conf}
        if self.imgsz:kwargs["imgsz"]=self.imgsz
        try:
            r=self._load().predict(np.asarray(image.convert("RGB")),**kwargs)[0]
            names=r.names;ds=[];mask_ratios={}
            boxes=r.boxes.xyxy.detach().cpu().numpy() if r.boxes is not None else np.empty((0,4))
            confs=r.boxes.conf.detach().cpu().numpy() if r.boxes is not None else np.empty((0,))
            classes=r.boxes.cls.detach().cpu().numpy().astype(int) if r.boxes is not None else np.empty((0,),dtype=int)
            masks=r.masks.data.detach().cpu().numpy() if getattr(r,"masks",None) is not None else None
            scale=(image.width*image.height)/(masks.shape[-2]*masks.shape[-1]) if masks is not None and masks.size else 1.0
            for i,(box,score,cls) in enumerate(zip(boxes,confs,classes)):
                label=str(names.get(int(cls),cls));area=None
                if masks is not None and i<len(masks):
                    area=float(masks[i].sum()*scale);mask_ratios[label]=mask_ratios.get(label,0.0)+area/(image.width*image.height)
                ds.append(Detection(label=label,score=float(score),box=[float(v) for v in box],area_px=area))
            plotted=r.plot()
            overlay=Image.fromarray(plotted[...,::-1]) if plotted.ndim==3 else image.convert("RGB")
            metrics={"detections":len(ds),"confidence_threshold":conf,"source_repo":self.repo_id}
            for k,v in mask_ratios.items():metrics[k+"_area_ratio"]=round(float(v),6)
            return EngineResult(engine_id=self.meta.id,name=self.meta.name,task=self.meta.task,status="ok",detections=ds,
                overlay_png_base64=png_b64(overlay),metrics=metrics)
        finally:
            self._release()

class ImprovedUNet(nn.Module):
    def __init__(self,in_channels=3,out_channels=1,depth=4,start_filters=64):
        super().__init__();self.depth=depth;self.start_filters=start_filters
        def block(a,b,drop=.2):
            return nn.Sequential(nn.Conv2d(a,b,3,padding=1),nn.BatchNorm2d(b),nn.ReLU(inplace=True),nn.Dropout2d(drop),
                nn.Conv2d(b,b,3,padding=1),nn.BatchNorm2d(b),nn.ReLU(inplace=True),nn.Dropout2d(drop))
        self.encoders=nn.ModuleList();self.pools=nn.ModuleList();ch=in_channels
        for i in range(depth):
            out=start_filters*(2**i);self.encoders.append(block(ch,out));self.pools.append(nn.MaxPool2d(2));ch=out
        bottleneck_ch=start_filters*(2**depth);self.bottleneck=block(ch,bottleneck_ch,.3)
        self.decoders=nn.ModuleList();self.upconvs=nn.ModuleList();current=bottleneck_ch
        for i in range(depth-1,-1,-1):
            out=start_filters*(2**i);self.upconvs.append(nn.ConvTranspose2d(current,out,2,2));self.decoders.append(block(out*2,out));current=out
        self.final_conv=nn.Conv2d(start_filters,out_channels,1);self.sigmoid=nn.Sigmoid()
    def forward(self,x):
        skips=[]
        for enc,pool in zip(self.encoders,self.pools):x=enc(x);skips.append(x);x=pool(x)
        x=self.bottleneck(x)
        for i,(up,dec) in enumerate(zip(self.upconvs,self.decoders)):
            x=up(x);skip=skips[-(i+1)]
            if x.shape[2:]!=skip.shape[2:]:x=F.interpolate(x,size=skip.shape[2:],mode="bilinear",align_corners=False)
            x=dec(torch.cat([x,skip],1))
        return self.sigmoid(self.final_conv(x))

class SamirUNetCrackAdapter(EngineAdapter):
    meta=AdapterMeta("unet_public_crack","U-Net Concrete Crack (public)","PyTorch / Hugging Face","semantic_segmentation",
        "U-Net treinada para segmentação binária de fissuras em concreto; checkpoint público compacto.",
        False,True,"public_shm_checkpoint","https://huggingface.co/samir-mohamed/concrete-crack-segmentation","MIT")
    def __init__(self):self.model=None
    def availability(self):return True,None
    def _load(self):
        if self.model is None:
            path=hf_hub_download(repo_id="samir-mohamed/concrete-crack-segmentation",filename="unet_model_weights.pth",cache_dir=CACHE_DIR)
            m=ImprovedUNet(3,1,4,64);state=torch.load(path,map_location="cpu",weights_only=True);m.load_state_dict(state,strict=True);self.model=m.eval()
        return self.model
    def _release(self):
        if _truthy("SHM_UNLOAD_AFTER_INFERENCE","1"):
            self.model=None;gc.collect()
    def predict(self,image):
        try:
            src=image.convert("RGB");resized=src.resize((256,256),Image.Resampling.LANCZOS);arr=np.asarray(resized,dtype=np.float32)/255.0
            x=torch.from_numpy(arr).permute(2,0,1);mean=torch.tensor([.485,.456,.406]).view(3,1,1);std=torch.tensor([.229,.224,.225]).view(3,1,1)
            x=((x-mean)/std).unsqueeze(0)
            with torch.inference_mode():p=self._load()(x)[0,0].cpu().numpy()
            threshold=float(os.getenv("SHM_PUBLIC_UNET_THRESHOLD",".50"))
            prob=Image.fromarray((np.clip(p,0,1)*255).astype(np.uint8)).resize(src.size,Image.Resampling.BILINEAR)
            prob_np=np.asarray(prob,dtype=np.float32)/255.0;mask=prob_np>=threshold;rgb=np.asarray(src,dtype=np.float32);out=rgb.copy()
            out[mask]=.55*rgb[mask]+.45*np.array([255,70,30],dtype=np.float32);area=int(mask.sum());ratio=area/mask.size
            ds=[Detection(label="crack",score=float(prob_np[mask].mean()) if area else float(prob_np.max()),area_px=float(area))] if area else []
            return EngineResult(engine_id=self.meta.id,name=self.meta.name,task=self.meta.task,status="ok",detections=ds,
                overlay_png_base64=png_b64(Image.fromarray(np.clip(out,0,255).astype(np.uint8))),
                metrics={"crack_area_ratio":round(float(ratio),6),"mean_probability":round(float(prob_np.mean()),6),
                    "max_probability":round(float(prob_np.max()),6),"threshold":threshold,"source_repo":"samir-mohamed/concrete-crack-segmentation"})
        finally:
            self._release()

def public_pathology_catalog():
    return [
        HFUltralyticsAdapter("yolov8_public_crack","YOLO Crack Detector (public)","Utbird/crack_detection","crack.pt","detection",
            "YOLO treinado especificamente para fissuras em superfícies de infraestrutura.","Apache-2.0","https://huggingface.co/Utbird/crack_detection",
            default_conf=".35"),
        HFUltralyticsAdapter("yolov8_public_damage_seg","YOLOv8 Structural Damage Segmentation (public)",
            "iloveass/kompon-damage-severity-detection","best.pt","instance_segmentation",
            "YOLOv8s-seg multiclasse para fissura estrutural, corrosão de armadura, desplacamento, microfissura e dano severo.",
            "Apache-2.0","https://huggingface.co/iloveass/kompon-damage-severity-detection",default_conf=".25"),
        HFUltralyticsAdapter("yolo_public_glasseye","GlassEye Infrastructure Defect Detector (public)",
            "sanjeevafk/glasseye-yolo-bfdd-cubit-v1","best.pt","detection",
            "YOLOv8n leve treinado em BFDD+CUBIT para triagem binária de defeitos de fachadas e infraestrutura de concreto.",
            "MIT","https://huggingface.co/sanjeevafk/glasseye-yolo",default_conf=".20",imgsz=320),
        HFUltralyticsAdapter("yolov8_public_corrosion","YOLOv8 Corrosion Segmentation (public)",
            "Decizez/yolov-corrosion-detection","Lite_YOLO8_v1.pt","instance_segmentation",
            "YOLOv8-Seg especializado em corrosão/ferrugem; complementar ao detector multiclasse de danos estruturais.",
            "MIT","https://huggingface.co/Decizez/yolov-corrosion-detection",default_conf=".25"),
        HFUltralyticsAdapter("yolo11_public_corrosion","YOLO11 Corrosion Segmentation (public)",
            "Decizez/yolov-corrosion-detection","Basic_YOLO11_v1.pt","instance_segmentation",
            "YOLO11-Seg especializado em corrosão/ferrugem, incluído como segundo motor supervisionado independente para comparação.",
            "MIT","https://huggingface.co/Decizez/yolov-corrosion-detection",default_conf=".25"),
        HFUltralyticsAdapter("yolov8n_public_crack_seg","YOLOv8n Crack Segmentation (OpenSistemas)",
            "OpenSistemas/YOLOv8-crack-seg","yolov8n/weights/best.pt","instance_segmentation",
            "YOLOv8n-Seg treinado no Crack-seg para segmentação de fissuras em superfícies de infraestrutura.",
            "AGPL-3.0","https://huggingface.co/OpenSistemas/YOLOv8-crack-seg",default_conf=".25"),
        SamirUNetCrackAdapter(),
    ]
