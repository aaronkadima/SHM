import os,torch,torch.nn as nn,numpy as np
from PIL import Image
from .base import EngineAdapter,AdapterMeta,png_b64
from ..schemas import Detection,EngineResult
CLASSES=["background","crack","spalling","corrosion","exposed_rebar","efflorescence","moisture","delamination","other"]
class DC(nn.Module):
    def __init__(self,a,b): super().__init__(); self.n=nn.Sequential(nn.Conv2d(a,b,3,padding=1),nn.ReLU(),nn.Conv2d(b,b,3,padding=1),nn.ReLU())
    def forward(self,x): return self.n(x)
class UNet(nn.Module):
    def __init__(self,n=9):
        super().__init__(); self.a=DC(3,32); self.b=DC(32,64); self.c=DC(64,128); self.m=DC(128,256); self.u3=nn.ConvTranspose2d(256,128,2,2); self.d3=DC(256,128); self.u2=nn.ConvTranspose2d(128,64,2,2); self.d2=DC(128,64); self.u1=nn.ConvTranspose2d(64,32,2,2); self.d1=DC(64,32); self.o=nn.Conv2d(32,n,1)
    def forward(self,x):
        a=self.a(x); b=self.b(nn.functional.max_pool2d(a,2)); c=self.c(nn.functional.max_pool2d(b,2)); m=self.m(nn.functional.max_pool2d(c,2))
        x=self.d3(torch.cat([self.u3(m),c],1)); x=self.d2(torch.cat([self.u2(x),b],1)); x=self.d1(torch.cat([self.u1(x),a],1)); return self.o(x)
class SegNet(nn.Module):
    def __init__(self,n=9):
        super().__init__(); self.e1=DC(3,32); self.e2=DC(32,64); self.e3=DC(64,128); self.d2=DC(128,64); self.d1=DC(64,32); self.o=nn.Conv2d(32,n,1)
    def forward(self,x):
        s=x.shape[-2:]; x=self.e1(x); x=self.e2(nn.functional.max_pool2d(x,2)); x=self.e3(nn.functional.max_pool2d(x,2)); x=nn.functional.interpolate(x,scale_factor=2,mode="bilinear",align_corners=False); x=self.d2(x); x=nn.functional.interpolate(x,scale_factor=2,mode="bilinear",align_corners=False); return nn.functional.interpolate(self.o(self.d1(x)),size=s,mode="bilinear",align_corners=False)
class CustomSegAdapter(EngineAdapter):
    def __init__(self,kind):
        self.kind=kind; self.env="SHM_UNET_WEIGHTS" if kind=="unet" else "SHM_SEGNET_WEIGHTS"; self.model=None
        self.meta=AdapterMeta(kind,"U-Net" if kind=="unet" else "SegNet","PyTorch","semantic_segmentation","Arquitetura nativa; requer checkpoint SHM.",True)
    def availability(self):
        p=os.getenv(self.env); return bool(p and os.path.exists(p)),None if p and os.path.exists(p) else "Defina "+self.env
    def _load(self):
        p=os.getenv(self.env)
        if not p or not os.path.exists(p): raise FileNotFoundError("Defina "+self.env)
        if self.model is None:
            self.model=(UNet(len(CLASSES)) if self.kind=="unet" else SegNet(len(CLASSES))).eval(); st=torch.load(p,map_location="cpu"); self.model.load_state_dict(st.get("state_dict",st),strict=False)
        return self.model
    def predict(self,image):
        a=np.asarray(image.convert("RGB").resize((512,512)),dtype=np.float32)/255; x=torch.from_numpy(a).permute(2,0,1).unsqueeze(0)
        with torch.inference_mode(): m=self._load()(x).argmax(1)[0].numpy().astype(np.uint8)
        m=np.asarray(Image.fromarray(m).resize(image.size,Image.Resampling.NEAREST)); rgb=np.asarray(image.convert("RGB")); pal=np.array([[0,0,0],[255,70,30],[255,180,0],[180,70,20],[255,255,0],[210,210,255],[40,140,255],[180,50,220],[255,255,255]],dtype=np.uint8); out=(.7*rgb+.3*pal[np.clip(m,0,8)]).astype(np.uint8)
        det=[]; met={}
        for i,n in enumerate(CLASSES[1:],1):
            area=int((m==i).sum()); met[n+"_ratio"]=round(area/m.size,6)
            if area: det.append(Detection(label=n,area_px=float(area)))
        return EngineResult(engine_id=self.meta.id,name=self.meta.name,task=self.meta.task,status="ok",detections=det,overlay_png_base64=png_b64(Image.fromarray(out)),metrics=met)
