# Browser Models

A camada browser permite que motores compactos sejam executados diretamente pelo GitHub Pages, sem Railway e sem servidor Python.

## Estado

- `opencv_crack`: **funcional no navegador**, implementado em JavaScript/Canvas.
- `cdm_1`: **funcional no navegador**, pipeline determinístico CDM 2.8.5.
- `yolov8n_public_crack_seg`: candidato avançado ONNX Runtime Web; runtime WASM, letterbox, NMS e reconstrução de máscara passaram no smoke de Chrome, aguardando paridade final com o backend.
- `unet_public_crack`: candidato ONNX Runtime Web; exportação e validação automatizadas.
- `segformer_public_crack`: **funcional no navegador**, ONNX Runtime Web/WASM com manifesto, SHA-256 e smoke test em Chrome.

Os candidatos ainda não promovidos permanecem com `browser_ready: false` até que o runtime Web, o pré/pós-processamento e a paridade com o backend sejam validados. O SegFormer já passou pela primeira promoção browser e usa os assets same-origin publicados junto ao GitHub Pages.

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

Cada motor produz dois assets:

```text
<engine>.onnx
<engine>.json
```

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
- tratamento de cancelamento, progresso e falha de carregamento.

Somente depois dessas etapas o catálogo deve marcar o motor como `browser_ready: true`.
