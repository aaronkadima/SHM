# SHM Vision Lab

Plataforma full-stack para comparar, a partir de **uma única imagem de inspeção**, múltiplos motores de visão computacional usados ou adaptáveis ao SHM e à inspeção visual de OAEs.

## Uso online — sem Docker local

- Frontend: https://aaronkadima.github.io/SHM/
- Backend de inferência: https://shm-api-production-01f8.up.railway.app
- Swagger/OpenAPI: https://shm-api-production-01f8.up.railway.app/docs

O frontend é publicado pelo GitHub Pages. A inferência roda no backend Railway, portanto o usuário final não precisa instalar Docker, Python ou modelos localmente.

## Fluxo implementado

1. Carregar uma imagem JPG, PNG ou WEBP.
2. Selecionar motores recomendados, todos os motores prontos ou motores específicos.
3. Executar a comparação em fila assíncrona, com progresso por motor.
4. Comparar imagem original, overlays, latência, achados e métricas.
5. Consultar concordância por categoria e mapa espacial de consenso.
6. Exportar JSON, CSV, mapa de consenso e overlays individuais.

Cada execução recebe um **analysis_id**, versão da API e timestamp UTC para rastreabilidade e reprodutibilidade.

## Perfil cloud verificado

O perfil de produção prioriza checkpoints públicos treinados para patologias de infraestrutura e descarrega modelos após cada inferência para limitar RAM. O warmup online verifica atualmente:

- YOLO Crack Detector — fissuras.
- YOLOv8 Structural Damage Segmentation — danos estruturais multiclasse.
- GlassEye YOLO — triagem de defeitos.
- YOLOv8 Corrosion Segmentation — corrosão/ferrugem.
- YOLOv8n Crack Segmentation — segmentação de fissuras.
- U-Net Concrete Crack — segmentação binária de fissuras.
- SegFormer-B0 Crack Segmentation — segmentação Transformer de fissuras.

O YOLO11 de corrosão e motores foundation/genéricos mais pesados permanecem registrados, mas não fazem parte do perfil cloud padrão quando excedem o envelope de memória disponível.

## Famílias registradas

YOLO11/YOLOv8, RT-DETR, Grounding DINO, OWLv2, CLIPSeg, SAM2/Grounded-SAM, Mask/Faster/Cascade R-CNN, PointRend, RTMDet, SOLOv2, CondInst, U-Net, SegNet, DeepLabV3+, SegFormer, HRNet/OCR, Mask2Former, YOLO-NAS, PatchCore, PaDiM, FastFlow e baseline OpenCV.

> Arquitetura não é sinônimo de detector de patologia. Para comparação científica, o sistema separa arquitetura, checkpoint, licença e modo de domínio. Motores supervisionados só devem ser interpretados como detectores da patologia para a qual o checkpoint foi treinado/validado.

## Arquitetura

- **Frontend:** React + Vite, publicado no GitHub Pages.
- **Backend:** FastAPI.
- **Inferência:** PyTorch/Transformers/Ultralytics/OpenCV.
- **Cache persistente:** volume Railway montado em `/models`.
- **Fila:** jobs assíncronos com limite de concorrência e retenção curta.
- **CI:** compilação do backend e build/deploy do frontend.
- **Proteção de deploy:** `python -m compileall -q app` antes do runtime no Railway.

## Execução local opcional

Docker continua disponível apenas para desenvolvimento local:

```bash
docker compose up --build
```

Frontend local: http://localhost:5173  
Swagger local: http://localhost:8000/docs

## Licenças e checkpoints

O repositório não deve redistribuir checkpoints de terceiros sem necessidade. Os adaptadores registram a fonte e a licença declarada do modelo/checkpoint. Antes de uso comercial, publicação de resultados ou redistribuição, confirme os termos do artefato original.
