from .adapters.opencv_adapter import OpenCVCrackAdapter
from .adapters.ultralytics_adapter import UltralyticsAdapter
from .adapters.grounding_adapter import GroundingDINOAdapter
from .adapters.custom_segmentation import CustomSegAdapter
from .adapters.optional_runtime import Detectron2Adapter,MMDetectionAdapter,MMSegAdapter,YoloNASAdapter,AnomalibAdapter,GroundedSAM2Adapter

def build():
    x=[
      OpenCVCrackAdapter(),GroundingDINOAdapter(),GroundedSAM2Adapter(),
      UltralyticsAdapter("yolo11","YOLO11","SHM_YOLO_WEIGHTS","yolo11n.pt"),
      UltralyticsAdapter("yolov8","YOLOv8","SHM_YOLOV8_WEIGHTS","yolov8n.pt"),
      UltralyticsAdapter("rtdetr","RT-DETR","SHM_RTDETR_WEIGHTS","rtdetr-l.pt"),
      CustomSegAdapter("unet"),CustomSegAdapter("segnet"),
      Detectron2Adapter("mask_rcnn","Mask R-CNN (Detectron2)","SHM_MASKRCNN_CONFIG","SHM_MASKRCNN_WEIGHTS"),
      Detectron2Adapter("pointrend","PointRend (Detectron2)","SHM_POINTREND_CONFIG","SHM_POINTREND_WEIGHTS"),
      MMDetectionAdapter("faster_rcnn","Faster R-CNN","SHM_FRCNN_CONFIG","SHM_FRCNN_WEIGHTS"),
      MMDetectionAdapter("cascade_mask_rcnn","Cascade Mask R-CNN","SHM_CASCADE_CONFIG","SHM_CASCADE_WEIGHTS"),
      MMDetectionAdapter("rtmdet","RTMDet","SHM_RTMDET_CONFIG","SHM_RTMDET_WEIGHTS"),
      MMDetectionAdapter("solov2","SOLOv2","SHM_SOLOV2_CONFIG","SHM_SOLOV2_WEIGHTS"),
      MMDetectionAdapter("condinst","CondInst","SHM_CONDINST_CONFIG","SHM_CONDINST_WEIGHTS"),
      MMSegAdapter("deeplabv3plus","DeepLabV3+","SHM_DEEPLAB_CONFIG","SHM_DEEPLAB_WEIGHTS"),
      MMSegAdapter("segformer","SegFormer","SHM_SEGFORMER_CONFIG","SHM_SEGFORMER_WEIGHTS"),
      MMSegAdapter("hrnet_ocr","HRNet/OCR","SHM_HRNET_CONFIG","SHM_HRNET_WEIGHTS"),
      MMSegAdapter("mask2former","Mask2Former","SHM_MASK2FORMER_CONFIG","SHM_MASK2FORMER_WEIGHTS"),
      YoloNASAdapter(),
      AnomalibAdapter("patchcore","PatchCore","SHM_PATCHCORE_CHECKPOINT"),
      AnomalibAdapter("padim","PaDiM","SHM_PADIM_CHECKPOINT"),
      AnomalibAdapter("fastflow","FastFlow","SHM_FASTFLOW_CHECKPOINT"),
    ]
    return {e.meta.id:e for e in x}
REGISTRY=build()
