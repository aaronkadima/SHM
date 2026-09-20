from .adapters.opencv_adapter import OpenCVCrackAdapter
from .adapters.ultralytics_adapter import UltralyticsAdapter
from .adapters.grounding_adapter import GroundingDINOAdapter
from .adapters.custom_segmentation import CustomSegAdapter
from .adapters.external_adapters import catalog
def build():
    x=[OpenCVCrackAdapter(),GroundingDINOAdapter(),UltralyticsAdapter("yolo11","YOLO11","SHM_YOLO_WEIGHTS","yolo11n.pt"),UltralyticsAdapter("yolov8","YOLOv8","SHM_YOLOV8_WEIGHTS","yolov8n.pt"),UltralyticsAdapter("rtdetr","RT-DETR","SHM_RTDETR_WEIGHTS","rtdetr-l.pt"),CustomSegAdapter("unet"),CustomSegAdapter("segnet")]
    x.extend(catalog()); return {e.meta.id:e for e in x}
REGISTRY=build()
