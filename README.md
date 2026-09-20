# SHM Vision Lab

Plataforma full-stack para comparar, com uma única imagem, múltiplos motores de visão computacional usados ou adaptáveis à inspeção visual de OAEs/SHM.

## Implementado
- Upload único e execução concorrente dos motores selecionados.
- Saída normalizada para detecção, segmentação, open-vocabulary, anomalia e baseline clássico.
- Comparação lado a lado com overlays, latência, achados e estado.
- OpenCV determinístico funcional sem checkpoint.
- Ultralytics YOLO11/YOLOv8/RT-DETR funcionais quando pacote/pesos estão disponíveis.
- Grounding DINO zero-shot por texto.
- U-Net e SegNet nativos para checkpoints SHM.
- Registry de Detectron2, MMDetection/MMSegmentation, YOLO-NAS e Anomalib.
- Docker Compose para frontend + backend.

Arquitetura não é sinônimo de detector de patologia. Modelos supervisionados precisam de checkpoints treinados/validados para fissura, corrosão, desplacamento, armadura exposta etc. O sistema mantém arquitetura e checkpoint separados para comparação cientificamente rastreável.

Famílias contempladas: YOLO11/YOLOv8, RT-DETR, Grounding DINO, SAM2/Grounded-SAM, Mask/Faster/Cascade R-CNN, PointRend, RTMDet, SOLO/SOLOv2, YOLACT, CondInst, SparseInst, U-Net, SegNet, DeepLabV3(+), SegFormer, HRNet/OCR, Mask2Former, YOLO-NAS, PatchCore, PaDiM, FastFlow e OpenCV.

## Executar
1. Instale Docker Desktop.
2. Execute: docker compose up --build
3. Frontend: http://localhost:5173
4. Swagger: http://localhost:8000/docs

Pesos locais ficam em models/. O repositório não redistribui checkpoints de terceiros; verifique a licença de cada engine/checkpoint.
