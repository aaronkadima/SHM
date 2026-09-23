# SHM Vision Lab

Plataforma para inspeção visual de OAEs e SHM com **motores independentes no próprio repositório** e comparação multi-engine opcional em nuvem.

## Princípio arquitetural

**O GitHub é a fonte dos motores. O Railway não é backend obrigatório dos motores.**

- **1 motor selecionado:** se houver runtime browser, a inferência ocorre diretamente no navegador; caso contrário, usa o backend standalone do próprio repositório. Railway não participa.
- **2 ou mais motores selecionados:** a mesma imagem é enviada ao **comparador Railway**, que orquestra os motores e devolve resultados normalizados, consenso e benchmark.
- Todos os adaptadores, pré/pós-processamentos e integrações de modelos permanecem versionados em `backend/app/adapters/`.
- O catálogo estático dos motores fica em `engines/catalog.json`.

## Frontend

GitHub Pages:

https://aaronkadima.github.io/SHM/

A página possui dois runtimes separados:

1. **Motor individual — standalone**
   - motores com runtime no navegador executam localmente no browser;
   - os demais exigem uma URL standalone HTTPS em Configurações;
   - usado somente quando exatamente um motor está selecionado e não envia a imagem ao Railway.

2. **Comparador multi-engine — Railway**
   - produção: `https://shm-api-production-01f8.up.railway.app`;
   - usado somente quando dois ou mais motores estão selecionados.

## Executar um motor isoladamente

No diretório `backend`:

```bash
python run_engine.py --engine segformer_public_crack --port 8001
```

Ou iniciar um servidor standalone capaz de receber qualquer motor registrado:

```bash
python run_engine.py --port 8001
```

Endpoints standalone:

- `GET /health`
- `GET /engines`
- `POST /infer` com `file` e `engine_id`

Exemplos:

```bash
python run_engine.py --engine opencv_crack --port 8001
python run_engine.py --engine yolov8n_public_crack_seg --port 8001
python run_engine.py --engine unet_public_crack --port 8001
python run_engine.py --engine segformer_public_crack --port 8001
```

O servidor standalone usa exatamente o mesmo código de motor que o comparador.

O CDM-1 possui uma imagem de serviço independente e leve em
[`backend/Dockerfile.cdm`](backend/Dockerfile.cdm). Veja
[`backend/CDM-1.md`](backend/CDM-1.md) para execução, calibração e configuração
de uma URL HTTPS pública sem instalar Docker no computador do usuário.

## Comparação multi-engine

O Railway é configurado com:

```text
SHM_ROLE=comparator
```

Nesse modo, o backend rejeita inferência comparativa com menos de dois motores. A responsabilidade do Railway é apenas:

- fila e controle de concorrência;
- execução sequencial/segura dos motores;
- normalização das saídas;
- consenso categórico;
- consenso espacial por IoU;
- medição de latência;
- exportação do resultado consolidado.

Endpoints principais:

- `GET /health`
- `GET /engines`
- `POST /jobs/compare`
- `GET /jobs/{id}`
- `POST /jobs/{id}/cancel`

## Motores registrados

Atualmente o catálogo contém **33 motores/configurações**, incluindo:

- OpenCV Crack Baseline;
- YOLOv8/YOLO11 para fissura, danos estruturais e corrosão;
- U-Net;
- SegFormer-B0;
- Grounding DINO;
- OWLv2;
- CLIPSeg;
- Grounded SAM2;
- RT-DETR;
- Mask R-CNN;
- PointRend;
- Faster R-CNN;
- Cascade Mask R-CNN;
- RTMDet;
- SOLOv2;
- CondInst;
- DeepLabV3+;
- HRNet/OCR;
- Mask2Former;
- YOLO-NAS;
- PatchCore;
- PaDiM;
- FastFlow.

Alguns possuem checkpoints públicos de patologia estrutural já integrados; outros exigem dependências, configuração e/ou checkpoints específicos do usuário.

## Resultados

A plataforma apresenta:

- imagem original;
- resultado individual de cada motor;
- sobreposição/segmentação;
- número de achados;
- latência;
- métricas específicas;
- taxonomia normalizada de patologias;
- concordância entre motores;
- mapa espacial de consenso;
- exportação JSON;
- exportação CSV;
- download dos overlays;
- `analysis_id`, versão da API e timestamp para rastreabilidade.

## Estrutura

```text
SHM/
├── engines/
│   ├── catalog.json
│   └── README.md
├── backend/
│   ├── run_engine.py
│   └── app/
│       ├── standalone.py
│       ├── main.py
│       ├── registry.py
│       └── adapters/
├── frontend/
└── .github/workflows/
```

### Responsabilidades

`standalone.py`  
Backend independente para **um motor por inferência**.

`main.py`  
Orquestrador multi-engine. Em produção Railway opera com `SHM_ROLE=comparator`.

`registry.py`  
Registro central dos motores disponíveis.

`engines/catalog.json`  
Catálogo estático consumido pelo frontend sem precisar consultar Railway.

## Desenvolvimento local completo

O Docker permanece disponível como conveniência de desenvolvimento, mas não é requisito para uso individual dos motores:

```bash
docker compose up --build
```

## Validade científica

Arquitetura de rede neural não equivale, por si só, a detector de patologia. O sistema distingue:

- arquitetura;
- checkpoint;
- fonte;
- licença;
- modo de domínio;
- status cloud;
- resultado individual;
- consenso multi-engine.

Um modelo supervisionado só deve ser interpretado como detector da manifestação patológica para a qual seu checkpoint foi treinado e validado.

## Licenças e pesos

Os adaptadores registram fonte e licença declarada dos checkpoints públicos. Pesos de terceiros não devem ser redistribuídos sem necessidade. Para uso comercial ou publicação de resultados, confirme sempre os termos do artefato original.


## Execução direta no navegador

O primeiro motor totalmente independente de servidor já está ativo:

- `opencv_crack` → JavaScript/Canvas no próprio GitHub Pages;
- pipeline alinhado ao backend Python: black-hat aproximado com kernel 15×15, suavização 3×3, limiar de Otsu, abertura 2×2 e componentes conectados;
- a imagem não é enviada ao Railway nem a um backend standalone;
- o resultado inclui overlay, componentes, área relativa da máscara e assinatura de implementação.

O catálogo possui os campos `browser_ready`, `browser_runtime` e `browser_candidate`.

Os próximos candidatos já possuem pipeline de exportação ONNX no repositório:

- `yolov8n_public_crack_seg`;
- `unet_public_crack`;
- `segformer_public_crack`.

Use:

```bash
pip install -r tools/requirements-browser-export.txt
python tools/export_browser_models.py --engine yolov8n_public_crack_seg
```

Os artefatos só devem ser promovidos para `browser_ready: true` depois da validação numérica entre ONNX/Web e o backend Python.
