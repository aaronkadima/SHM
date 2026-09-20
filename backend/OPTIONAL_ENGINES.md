# Motores opcionais

Alguns frameworks de pesquisa não são instalados no Docker base porque a versão compatível depende de CUDA, PyTorch e compiladores do ambiente.

## SAM 2

Instale a implementação oficial compatível com seu ambiente e configure:

```bash
pip install "git+https://github.com/facebookresearch/sam2.git"
```

```env
SAM2_CONFIG=configs/sam2.1/sam2.1_hiera_l.yaml
SAM2_CHECKPOINT=/models/sam2.1_hiera_large.pt
```

## Detectron2

Instale Detectron2 conforme a matriz PyTorch/CUDA do ambiente e configure `DETECTRON2_CONFIG` e `DETECTRON2_WEIGHTS`.

## MMSegmentation

Instale `mmengine`, `mmcv` e `mmsegmentation` compatíveis. O adaptador aceita pares config/checkpoint para SegNet, HRNet/OCR, UPerNet/Swin e modelos de fissura implementados no ecossistema MMSeg.

## Pesos de patologias

Pesos generalistas COCO/ADE20K não devem ser tratados como detectores validados de fissuras, desplacamento, corrosão ou exposição de armadura. Use checkpoints treinados/fine-tuned em dados de inspeção estrutural e registre a proveniência no experimento.
