# Browser Models

A camada browser permite que motores compactos sejam executados diretamente pelo GitHub Pages, sem Railway e sem servidor Python.

## Estado

- `opencv_crack`: **funcional no navegador**, implementado em JavaScript/Canvas.
- `cdm_1`: **funcional no navegador**, pipeline determinístico CDM 2.8.5.
- `yolov8n_public_crack_seg`: **funcional no navegador**, ONNX Runtime Web/WASM com letterbox, NMS, reconstrução de máscara e paridade quantitativa validada contra o backend Ultralytics/PyTorch.
- `unet_public_crack`: candidato **INT8 ONNX Runtime Web**; FP32 124,1 MB → INT8 39,5 MB (−68,15%), runtime WASM e paridade técnica aprovados, porém promoção bloqueada pelo quality gate porque o checkpoint satura em imagens reais externas.
- `segformer_public_crack`: **funcional no navegador**, ONNX Runtime Web/WASM com manifesto, SHA-256 e smoke test em Chrome.
- `crackenpy_public_crack`: **funcional no navegador**, INT8 ONNX Runtime Web/WASM com licença BSD; 102,3 MB → 26,3 MB (−74,25%), paridade PyTorch→ONNX `IoU=1,0`, INT8→FP32 `IoU≈0,95` e qualidade em concreto rotulado `IoU≈0,65` / `Dice≈0,79`, validada também por máscara pixel a pixel no Chrome.

Os candidatos ainda não promovidos permanecem com `browser_ready: false` até que o runtime Web, o pré/pós-processamento e a paridade com o backend sejam validados. SegFormer e YOLOv8n Crack Segmentation já foram promovidos e usam assets same-origin publicados junto ao GitHub Pages.

## Pipeline de artefatos

O workflow `.github/workflows/browser-models.yml`:

1. baixa o checkpoint público declarado pelo motor;
2. exporta para ONNX;
3. valida o grafo com `onnx.checker`;
4. cria `manifest.json` com SHA-256, tamanho, opset, entradas e saídas;
5. executa uma inferência de smoke test usando ONNX Runtime CPU;
6. publica o bundle validado como artefato do GitHub Actions;
7. publica os arquivos no release do próprio repositório:
   - `browser-models-dev` para a branch `dev`;
   - `browser-models-stable` para a branch `main`.

Cada motor produz pelo menos dois assets:

```text
<engine>.onnx
<engine>.json
```

A U-Net mantém também a variante experimental otimizada e seus artefatos de regressão:

```text
unet_public_crack.int8.onnx
unet_public_crack.int8.json
unet_public_crack.int8.parity.png
unet_public_crack.int8.parity.json
```

A variante INT8 usa quantização estática QDQ (Conv), calibração MinMax e pesos INT8 por canal. O artefato só pode ser promovido a `browser_ready` quando **duas condições independentes** passarem: consistência FP32×INT8 e quality gate do checkpoint em imagens reais.

O JSON é o manifesto de integridade usado para verificar o binário antes de habilitar a inferência Web.

## Execução manual

```bash
pip install -r backend/requirements.txt
pip install -r tools/requirements-browser-export.txt

python tools/export_browser_models.py --engine yolov8n_public_crack_seg
python tools/validate_browser_model.py --engine yolov8n_public_crack_seg

python tools/export_browser_models.py --engine unet_public_crack
python tools/validate_browser_model.py --engine unet_public_crack

python tools/export_browser_models.py --engine segformer_public_crack
python tools/validate_browser_model.py --engine segformer_public_crack
```

Saída local:

```text
browser-models/artifacts/<engine>/model.onnx
browser-models/artifacts/<engine>/manifest.json
```

## Critério para `browser_ready`

A promoção exige, no mínimo:

- artefato ONNX publicado;
- checksum validado;
- carregamento via ONNX Runtime Web;
- pré-processamento equivalente ao backend Python;
- pós-processamento equivalente ao backend Python;
- comparação numérica em imagens de referência;
- smoke test em desktop e mobile;
- tratamento de cancelamento, progresso e falha de carregamento;
- quality gate em imagens reais externas para impedir promoção de checkpoints que colapsem ou saturem, mesmo quando a conversão ONNX/INT8 estiver numericamente correta.

Somente depois dessas etapas o catálogo deve marcar o motor como `browser_ready: true`.

CrackenPy foi promovido somente após o CI completo permanecer verde com os assets do release e a validação da máscara rotulada diretamente no Chrome.
