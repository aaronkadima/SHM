# SHM Multi-Engine Lab

Plataforma web full-stack para executar **uma única imagem de inspeção** em múltiplos motores de visão computacional usados em Structural Health Monitoring (SHM) e comparar as saídas lado a lado, sem misturar resultados de modelos não treinados para patologias com resultados efetivamente calibrados para o domínio.

## O que está implementado

- Frontend React + TypeScript + Vite, com upload único, seleção de motores, catálogo de disponibilidade e grade comparativa.
- Backend FastAPI com registro extensível de motores, carregamento preguiçoso, cache em memória, normalização de detecções/segmentações e execução concorrente controlada.
- Baseline clássico OpenCV funcional sem pesos externos.
- Adaptadores para Ultralytics (YOLO/YOLO-seg, RT-DETR, YOLO-World e FastSAM), Grounding DINO, Hugging Face semantic/instance segmentation, `segmentation-models-pytorch`, Detectron2, MMSegmentation, SAM 2 e ONNX.
- Catálogo SHM com arquiteturas adicionais: U-Net/U-Net++, SegNet, DeepLabV3+, PSPNet, FPN, PAN, MAnet, LinkNet, SegFormer, Mask2Former, HRNet/OCR, UPerNet/Swin, CrackFormer/CrackFormer-II e DINOv2 segmentation.
- Docker Compose, Nginx e CI.
- Protocolo científico para comparação reprodutível em `docs/SCIENTIFIC_PROTOCOL.md`.

> **Importante:** “motor implementado” significa que a integração de inferência está disponível. Pesos treinados para patologias não são inventados nem redistribuídos. Motores que dependem de checkpoint específico aparecem como `requires_weights` até que o checkpoint correspondente seja configurado.

## Taxonomia normalizada

A API normaliza rótulos para uma taxonomia comum quando possível:

`crack`, `spalling`, `delamination`, `corrosion`, `exposed_rebar`, `efflorescence`, `moisture`, `honeycombing`, `scaling`, `abrasion`, `joint_damage`, `bearing_damage`, `other`.

## Execução rápida

```bash
cp .env.example .env
docker compose up --build
```

A interface fica em `http://localhost:8080` e a documentação da API em `http://localhost:8000/docs`.

Por padrão o Docker instala o conjunto AI principal (`torch`, `ultralytics`, `transformers`, `segmentation-models-pytorch`, `onnxruntime`). Detectron2, MMSegmentation e SAM 2 são extras porque a instalação depende da combinação CUDA/PyTorch. Consulte `backend/OPTIONAL_ENGINES.md`.

## Configuração de pesos

Coloque os checkpoints em `./models` ou aponte variáveis de ambiente. Exemplos:

```env
YOLO11_DET_WEIGHTS=/models/yolo11_damage.pt
YOLO11_SEG_WEIGHTS=/models/yolo11_damage_seg.pt
RTDETR_WEIGHTS=/models/rtdetr_damage.pt
UNET_WEIGHTS=/models/unet_damage.pth
SEGFORMER_MODEL=/models/segformer_damage
SAM2_CONFIG=configs/sam2.1/sam2.1_hiera_l.yaml
SAM2_CHECKPOINT=/models/sam2.1_hiera_large.pt
```

O endpoint `GET /api/engines` informa, para cada motor, se está pronto, se falta dependência ou se falta checkpoint.

## API

- `GET /api/health`
- `GET /api/engines`
- `POST /api/analyze` — `multipart/form-data` com `file`, `engine_ids` e `confidence`.

Exemplo:

```bash
curl -X POST http://localhost:8000/api/analyze \
  -F "file=@bridge.jpg" \
  -F 'engine_ids=["opencv-morphology","grounding-dino"]' \
  -F "confidence=0.25"
```

## Critério científico

A grade lado a lado não constitui um ranking de acurácia. Para comparar desempenho entre modelos, use os mesmos dados anotados, a mesma taxonomia, o mesmo protocolo de split e métricas apropriadas (mAP/IoU/Dice/precision/recall), conforme `docs/SCIENTIFIC_PROTOCOL.md`.
