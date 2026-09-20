# Browser Models

A camada browser permite que motores compactos sejam executados diretamente pelo GitHub Pages, sem Railway e sem servidor Python.

## Estado

- `opencv_crack`: **funcional no navegador**, implementado em JavaScript/Canvas.
- `yolov8n_public_crack_seg`: candidato a ONNX Runtime Web; script de exportação incluído.
- `unet_public_crack`: candidato a ONNX Runtime Web; script de exportação incluído.
- `segformer_public_crack`: candidato a ONNX Runtime Web; script de exportação incluído.

Os artefatos ONNX não são marcados como `browser_ready` antes de serem exportados, validados numericamente contra o backend Python e publicados.

## Exportação

Instale as dependências normais do backend e:

```bash
pip install -r tools/requirements-browser-export.txt
python tools/export_browser_models.py --engine yolov8n_public_crack_seg
python tools/export_browser_models.py --engine unet_public_crack
python tools/export_browser_models.py --engine segformer_public_crack
```

Saída: `browser-models/artifacts/<engine>/model.onnx`.

A etapa seguinte é validar erro numérico, pós-processamento e desempenho WebGPU/WASM antes de promover cada motor para `browser_ready: true`.
