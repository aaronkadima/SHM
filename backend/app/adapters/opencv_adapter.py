import cv2,numpy as np
from PIL import Image
from .base import EngineAdapter,AdapterMeta,png_b64
from ..schemas import Detection,EngineResult
class OpenCVCrackAdapter(EngineAdapter):
    meta=AdapterMeta("opencv_crack","OpenCV Crack Morphology","OpenCV","classical","Black-hat + Otsu + morfologia + componentes conectados.")
    def predict(self,image):
        rgb=np.asarray(image.convert("RGB")); gray=cv2.cvtColor(rgb,cv2.COLOR_RGB2GRAY)
        k=cv2.getStructuringElement(cv2.MORPH_RECT,(15,15))
        bh=cv2.morphologyEx(gray,cv2.MORPH_BLACKHAT,k); bh=cv2.GaussianBlur(bh,(3,3),0)
        _,mask=cv2.threshold(bh,0,255,cv2.THRESH_BINARY+cv2.THRESH_OTSU)
        mask=cv2.morphologyEx(mask,cv2.MORPH_OPEN,np.ones((2,2),np.uint8))
        n,lab,stats,_=cv2.connectedComponentsWithStats(mask,8)
        out=rgb.copy(); ds=[]; min_area=max(8,int(rgb.shape[0]*rgb.shape[1]*.00002))
        for i in range(1,n):
            x,y,w,h,a=stats[i]
            if a<min_area: continue
            ds.append(Detection(label="crack_candidate",box=[x,y,x+w,y+h],area_px=float(a)))
            cv2.rectangle(out,(x,y),(x+w,y+h),(255,80,30),2)
        return EngineResult(engine_id=self.meta.id,name=self.meta.name,task=self.meta.task,status="ok",detections=ds,overlay_png_base64=png_b64(Image.fromarray(out)),metrics={"candidate_count":len(ds),"mask_area_ratio":round(float((mask>0).mean()),6),"kernel":"15x15","open_kernel":"2x2","implementation":"blackhat-15x15-otsu-open2-v1","runtime":"python-opencv"})
