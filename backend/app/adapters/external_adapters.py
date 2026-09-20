import importlib.util,os
from .base import EngineAdapter,AdapterMeta
from ..schemas import EngineResult
class ExternalAdapter(EngineAdapter):
    def __init__(self,eid,name,family,task,pkg,desc,envs=()):
        self.pkg=pkg; self.envs=envs; self.meta=AdapterMeta(eid,name,family,task,desc,bool(envs))
    def availability(self):
        if importlib.util.find_spec(self.pkg) is None:return False,"Dependência opcional ausente: "+self.pkg
        miss=[x for x in self.envs if not os.getenv(x)]
        return (False,"Configure "+", ".join(miss)) if miss else (True,None)
    def predict(self,image):
        ok,why=self.availability()
        if not ok:
            st="missing_dependency" if "Dependência" in why else "missing_weights"
            return EngineResult(engine_id=self.meta.id,name=self.meta.name,task=self.meta.task,status=st,message=why)
        return EngineResult(engine_id=self.meta.id,name=self.meta.name,task=self.meta.task,status="skipped",message="Motor registrado e ambiente detectado. Worker específico usa config/checkpoint SHM informado.")
def catalog():
    return [
      ExternalAdapter("sam2","Grounded SAM 2","Meta SAM2","instance_segmentation","sam2","Refino de caixas Grounding DINO para máscaras precisas.",("SHM_SAM2_CHECKPOINT","SHM_SAM2_CONFIG")),
      ExternalAdapter("detectron2","Detectron2 / Mask R-CNN","Detectron2","instance_segmentation","detectron2","Mask R-CNN, Cascade, PointRend e DeepLab.",("SHM_DETECTRON_CONFIG","SHM_DETECTRON_WEIGHTS")),
      ExternalAdapter("mmdetection","MMDetection","OpenMMLab","instance_segmentation","mmdet","Faster/Mask/Cascade R-CNN, RTMDet, SOLOv2, YOLACT, CondInst, SparseInst, Mask2Former.",("SHM_MMDET_CONFIG","SHM_MMDET_WEIGHTS")),
      ExternalAdapter("mmsegmentation","MMSegmentation","OpenMMLab","semantic_segmentation","mmseg","DeepLabV3+, SegFormer, HRNet/OCR, U-Net, PSPNet, Mask2Former.",("SHM_MMSEG_CONFIG","SHM_MMSEG_WEIGHTS")),
      ExternalAdapter("yolo_nas","YOLO-NAS","SuperGradients","detection","super_gradients","YOLO-NAS com checkpoint SHM.",("SHM_YOLONAS_WEIGHTS",)),
      ExternalAdapter("patchcore","PatchCore","Anomalib","anomaly","anomalib","Localização não supervisionada de anomalias.",("SHM_ANOMALIB_CHECKPOINT",)),
      ExternalAdapter("padim","PaDiM","Anomalib","anomaly","anomalib","Localização não supervisionada de anomalias.",("SHM_ANOMALIB_CHECKPOINT",)),
      ExternalAdapter("fastflow","FastFlow","Anomalib","anomaly","anomalib","Anomaly localization por normalizing flows.",("SHM_ANOMALIB_CHECKPOINT",))
    ]
