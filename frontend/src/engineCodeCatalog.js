import cdmBrowserSource from "./cdmBrowser.js?raw";
import cdm3SpatialBrowserSource from "./cdm3SpatialBrowser.js?raw";
import spatialAssetSource from "./spatialAsset.js?raw";
import browserEnginesSource from "./browserEngines.js?raw";
import onnxBrowserSource from "./onnxBrowser.js?raw";

function cleanId(value){
  return String(value||"engine").replace(/[^a-zA-Z0-9_-]+/g,"-").replace(/^-+|-+$/g,"").toLowerCase();
}
function commentHeader(engine,kind,stages){
  const source=engine.source_url?`// Origem do modelo/checkpoint: ${engine.source_url}\n`:"";
  const license=engine.license?`// Licença declarada no catálogo: ${engine.license}\n`:"";
  return `// SHM · pacote de implementação isolada
// Motor: ${engine.name} (${engine.id})
// Família: ${engine.family} · tarefa: ${engine.task}
// Tipo deste arquivo: ${kind}
${source}${license}//
// Etapas da implementação:
// ${stages.map((step,index)=>`${index+1}. ${step}`).join("\n// ")}
//
// Observação: preserve os requisitos/licenças do modelo original ao portar este motor.

`;
}
function pythonTemplate(engine){
  const family=String(engine.family||"").toLowerCase();
  const id=cleanId(engine.id);
  const commonStages=[
    "Instalar o runtime da família e carregar o checkpoint/modelo configurado.",
    "Converter a imagem de entrada para RGB e normalizar o formato esperado pelo runtime.",
    "Executar a inferência preservando limiar, resolução e demais parâmetros do motor.",
    "Converter a saída do runtime para detecções/segmentações em coordenadas da imagem original.",
    "Retornar um payload estável e independente da plataforma de origem."
  ];

  if(family.includes("ultralytics")){
    const ctor=String(engine.id).includes("rtdetr")?"RTDETR":"YOLO";
    return commentHeader(engine,"template de portabilidade Python",commonStages)+`from pathlib import Path
import numpy as np
from PIL import Image
from ultralytics import YOLO, RTDETR

ENGINE_ID = "${engine.id}"
MODEL_SOURCE = "${engine.source_url||"defina-o-checkpoint-local"}"
CONFIDENCE = 0.25

def load_engine(weights: str):
    # Etapa 1 — carregar o checkpoint no runtime Ultralytics.
    model_cls = ${ctor}
    return model_cls(weights)

def preprocess(image: Image.Image) -> np.ndarray:
    # Etapa 2 — padronizar a entrada em RGB, sem alterar a geometria original.
    return np.asarray(image.convert("RGB"))

def infer(model, image: Image.Image):
    # Etapa 3 — executar a inferência com um limiar explícito e reproduzível.
    result = model.predict(preprocess(image), conf=CONFIDENCE, verbose=False)[0]
    return result

def serialize(result):
    # Etapa 4 — converter o objeto Ultralytics em uma estrutura portátil.
    names = result.names
    detections = []
    if result.boxes is not None:
        boxes = result.boxes.xyxy.detach().cpu().numpy()
        scores = result.boxes.conf.detach().cpu().numpy()
        classes = result.boxes.cls.detach().cpu().numpy().astype(int)
        for box, score, cls in zip(boxes, scores, classes):
            detections.append({
                "label": str(names.get(int(cls), cls)),
                "score": float(score),
                "box": [float(v) for v in box],
            })
    return {"engine_id": ENGINE_ID, "detections": detections}

def run(weights: str, image_path: str):
    # Etapa 5 — API mínima para reutilização isolada em outra aplicação.
    image = Image.open(image_path)
    model = load_engine(weights)
    return serialize(infer(model, image))
`;
  }

  if(family.includes("detectron2")){
    return commentHeader(engine,"template de portabilidade Python",commonStages)+`from PIL import Image
import numpy as np
from detectron2.config import get_cfg
from detectron2.engine import DefaultPredictor

ENGINE_ID = "${engine.id}"

def load_engine(config_path: str, weights_path: str):
    # Etapa 1 — reconstruir a configuração e vincular o checkpoint.
    cfg = get_cfg()
    cfg.merge_from_file(config_path)
    cfg.MODEL.WEIGHTS = weights_path
    cfg.MODEL.ROI_HEADS.SCORE_THRESH_TEST = 0.25
    return DefaultPredictor(cfg)

def run(predictor, image_path: str):
    # Etapas 2–5 — RGB/BGR, inferência e serialização independente do SHM.
    rgb = np.asarray(Image.open(image_path).convert("RGB"))
    outputs = predictor(rgb[..., ::-1])
    instances = outputs["instances"].to("cpu")
    return {
        "engine_id": ENGINE_ID,
        "boxes": instances.pred_boxes.tensor.numpy().tolist(),
        "scores": instances.scores.numpy().tolist(),
        "classes": instances.pred_classes.numpy().tolist(),
    }
`;
  }

  if(family.includes("mmdetection")){
    return commentHeader(engine,"template de portabilidade Python",commonStages)+`from mmdet.apis import init_detector, inference_detector

ENGINE_ID = "${engine.id}"

def load_engine(config_path: str, checkpoint_path: str, device: str = "cpu"):
    # Etapa 1 — inicializar o detector com configuração e checkpoint explícitos.
    return init_detector(config_path, checkpoint_path, device=device)

def run(model, image_path: str):
    # Etapas 2–4 — o MMDetection recebe o arquivo, processa e devolve DataSample.
    sample = inference_detector(model, image_path)
    pred = sample.pred_instances.cpu()
    return {
        "engine_id": ENGINE_ID,
        "boxes": pred.bboxes.numpy().tolist(),
        "scores": pred.scores.numpy().tolist(),
        "classes": pred.labels.numpy().tolist(),
    }
`;
  }

  if(family.includes("mmseg")){
    return commentHeader(engine,"template de portabilidade Python",commonStages)+`from mmseg.apis import init_model, inference_model

ENGINE_ID = "${engine.id}"

def load_engine(config_path: str, checkpoint_path: str, device: str = "cpu"):
    # Etapa 1 — carregar arquitetura e pesos no MMSegmentation.
    return init_model(config_path, checkpoint_path, device=device)

def run(model, image_path: str):
    # Etapas 2–4 — executar a segmentação e exportar a máscara em formato portátil.
    sample = inference_model(model, image_path)
    mask = sample.pred_sem_seg.data.squeeze().cpu().numpy()
    return {"engine_id": ENGINE_ID, "mask": mask.tolist()}
`;
  }

  if(family.includes("pytorch")){
    return commentHeader(engine,"template de portabilidade Python",commonStages)+`import torch
import numpy as np
from PIL import Image

ENGINE_ID = "${engine.id}"

def load_engine(checkpoint_path: str, model_factory):
    # Etapa 1 — criar a arquitetura e carregar somente o state_dict confiável.
    model = model_factory()
    state = torch.load(checkpoint_path, map_location="cpu")
    model.load_state_dict(state)
    model.eval()
    return model

def preprocess(image_path: str):
    # Etapa 2 — adapte normalização/resolução ao protocolo do checkpoint.
    image = np.asarray(Image.open(image_path).convert("RGB"), dtype=np.float32) / 255.0
    tensor = torch.from_numpy(image).permute(2, 0, 1).unsqueeze(0)
    return tensor

@torch.inference_mode()
def run(model, image_path: str):
    # Etapas 3–5 — inferência, pós-processamento e contrato portátil.
    prediction = model(preprocess(image_path))
    return {"engine_id": ENGINE_ID, "prediction": prediction.cpu().numpy().tolist()}
`;
  }

  if(family.includes("anomalib")){
    return commentHeader(engine,"template de portabilidade Python",commonStages)+`# O Anomalib possui APIs diferentes conforme a versão e a arquitetura.
# Use o checkpoint cadastrado para ${engine.name} e preserve o pré/pós-processamento
# definido pelo projeto de treinamento ao criar o Engine/Model do Anomalib.

ENGINE_ID = "${engine.id}"

def run(anomalib_engine, model, image_path: str):
    # Etapa 1 — engine/model já reconstruídos com o checkpoint correto.
    # Etapa 2 — enviar a imagem sem alterar o referencial geométrico.
    predictions = anomalib_engine.predict(model=model, data_path=image_path)
    # Etapas 3–5 — converta anomaly_map, score e máscara para seu contrato externo.
    return {"engine_id": ENGINE_ID, "predictions": predictions}
`;
  }

  return commentHeader(engine,"template de portabilidade Python",commonStages)+`ENGINE_ID = "${engine.id}"
MODEL_SOURCE = "${engine.source_url||"checkpoint/runtime configurado no ambiente"}"

def load_engine():
    # Etapa 1 — carregue aqui o runtime e o checkpoint específicos deste motor.
    raise NotImplementedError("Conecte o runtime da família ${engine.family}.")

def preprocess(image):
    # Etapa 2 — normalize a entrada exatamente como no treinamento/checkpoint.
    return image

def infer(model, image):
    # Etapa 3 — execute o runtime preservando os parâmetros do motor.
    raise NotImplementedError

def postprocess(raw_output):
    # Etapa 4 — converta a saída para caixas, máscaras ou mapa de anomalia.
    return raw_output

def run(image):
    # Etapa 5 — ponto de entrada isolado para outra plataforma.
    model = load_engine()
    return {"engine_id": ENGINE_ID, "result": postprocess(infer(model, preprocess(image)))}
`;
}

function openCvStandaloneSource(){
  // O arquivo browserEngines.js contém o OpenCV e o despachante compartilhado.
  // Para exportação isolada removemos apenas a dependência do CDM e o despachante final,
  // preservando literalmente os helpers e runOpenCVBaseline usados pela plataforma.
  const withoutBrowserImports=browserEnginesSource.replace(/^import\{runCdmBrowser\}from"\.\/cdmBrowser\.js";\s*/,"").replace(/^import\{[^\n]*\}from"\.\/onnxBrowser\.js";\s*/,"");
  const dispatcher=withoutBrowserImports.indexOf("export function browserEngineSupported");
  const implementation=dispatcher>=0?withoutBrowserImports.slice(0,dispatcher):withoutBrowserImports;
  return implementation+"\nexport {runOpenCVBaseline};\n";
}

export function engineCodePackage(engine){
  if(!engine)return null;
  if(engine.id==="cdm_3"){
    const repositorySource=cdm3SpatialBrowserSource+"\n\n"+spatialAssetSource;
    return {
      kind:"Código real · CDM-3 espacial DEV",
      language:"javascript",
      fileName:"cdm-3-spatial-browser.js",
      repositoryPath:"frontend/src/cdm3SpatialBrowser.js + frontend/src/spatialAsset.js",
      repositorySource,
      source:commentHeader(engine,"código real do motor espacial browser",[
        "Reconhecer LAS, XYZ e IFC como entradas espaciais próprias do CDM-3.",
        "Ler LAS binário preservando escala, offset, formato de ponto e amostragem controlada.",
        "Ler XYZ e extrair coordenadas IFC para prévia espacial no canvas.",
        "Recentralizar apenas a prévia 3D, mantendo bounds/origem absolutos nos metadados.",
        "Serializar o ativo espacial no contrato SHM e encaminhar o pipeline profundo ao backend CDM-3."
      ])+repositorySource
    };
  }
  if(engine.id==="cdm_1"){
    return {
      kind:"Código real · browser",
      language:"javascript",
      fileName:"cdm-1-browser.js",
      repositoryPath:"frontend/src/cdmBrowser.js",
      repositorySource:cdmBrowserSource,
      source:commentHeader(engine,"código real do motor browser",[
        "Ler e normalizar a imagem preservando a geometria de pixels.",
        "Construir respostas morfológicas e máscaras das cinco famílias de patologia.",
        "Extrair componentes/registros e quantificar geometria por camada.",
        "Executar alinhamento e gate de qualidade quando houver inspeção t0.",
        "Serializar camadas, métricas e resumo para o contrato SHM."
      ])+cdmBrowserSource
    };
  }
  if(engine.id==="yolov8n_public_crack_seg"){
    return {
      kind:"Código real · ONNX browser",
      language:"javascript",
      fileName:"yolov8n-crack-seg-onnx-browser.js",
      repositoryPath:"frontend/src/onnxBrowser.js",
      repositorySource:onnxBrowserSource,
      source:commentHeader(engine,"runtime real ONNX no navegador",[
        "Aplicar letterbox 640×640 e normalização RGB/CHW do checkpoint.",
        "Validar manifesto, tamanho e SHA-256 do modelo antes da sessão.",
        "Executar YOLOv8n-Seg via ONNX Runtime Web/WASM.",
        "Aplicar confiança, NMS e reconstrução de máscara a partir dos 32 protótipos.",
        "Mapear caixas/máscaras para a imagem original e serializar o contrato SHM."
      ])+onnxBrowserSource
    };
  }
  if(engine.id==="unet_public_crack"){
    return {
      kind:"Código real · ONNX browser candidato · quality gate bloqueado",
      language:"javascript",
      fileName:"unet-crack-int8-onnx-browser.js",
      repositoryPath:"frontend/src/onnxBrowser.js",
      repositorySource:onnxBrowserSource,
      source:commentHeader(engine,"runtime INT8 ONNX validado no navegador",[
        "Aplicar resize 256×256 e normalização ImageNet idênticos ao inference.py original.",
        "Carregar a variante INT8 QDQ (~39,5 MB) e validar tamanho/SHA-256 antes da sessão.",
        "Executar a U-Net via ONNX Runtime Web/WASM e reconstruir o mapa probabilístico.",
        "Aplicar limiar 0,5, overlay e métricas preservando o contrato SHM.",
        "Manter browser_ready bloqueado enquanto o checkpoint saturar em imagens reais externas."
      ])+onnxBrowserSource
    };
  }
  if(engine.id==="crackenpy_public_crack"){
    return {
      kind:"Código real · ONNX browser",
      language:"javascript",
      fileName:"crackenpy-fpn-int8-onnx-browser.js",
      repositoryPath:"frontend/src/onnxBrowser.js",
      repositorySource:onnxBrowserSource,
      source:commentHeader(engine,"runtime INT8 ONNX candidato no navegador",[
        "Aplicar resize 416×416 e normalização ImageNet do CrackenPy.",
        "Validar manifesto, tamanho e SHA-256 do modelo INT8 antes da sessão.",
        "Executar FPN/ResNeXt50-32x4d via ONNX Runtime Web/WASM.",
        "Aplicar argmax multiclasse e extrair a classe fissura (id 2).",
        "Gerar máscara em espaço do modelo, overlay e métricas SHM preservando a paridade com PyTorch."
      ])+onnxBrowserSource
    };
  }
  if(engine.id==="segformer_public_crack"){
    return {
      kind:"Código real · ONNX browser",
      language:"javascript",
      fileName:"segformer-onnx-browser.js",
      repositoryPath:"frontend/src/onnxBrowser.js",
      repositorySource:onnxBrowserSource,
      source:commentHeader(engine,"runtime real ONNX no navegador",[
        "Resolver o manifesto e o modelo ONNX pelo mesmo domínio do GitHub Pages.",
        "Validar tamanho e SHA-256 do artefato antes de criar a sessão.",
        "Normalizar a imagem RGB conforme o AutoImageProcessor do checkpoint.",
        "Executar SegFormer via ONNX Runtime Web/WASM e aplicar softmax/limiar para a classe fissura.",
        "Reconstruir overlay e métricas no contrato padrão SHM sem enviar a imagem ao Railway."
      ])+onnxBrowserSource
    };
  }
  if(engine.id==="opencv_crack"){
    return {
      kind:"Código real · browser",
      language:"javascript",
      fileName:"opencv-crack-browser.js",
      repositoryPath:"frontend/src/browserEngines.js",
      repositorySource:browserEnginesSource,
      source:commentHeader(engine,"código real do runtime browser compartilhado",[
        "Converter a imagem para escala de cinza.",
        "Aplicar fechamento morfológico e black-hat para realçar candidatos escuros.",
        "Aplicar suavização, limiar de Otsu e abertura morfológica.",
        "Extrair componentes conectados e filtrar por área.",
        "Serializar detecções, métricas e overlay."
      ])+openCvStandaloneSource()
    };
  }
  const source=pythonTemplate(engine);
  return {
    kind:engine.source_url?"Template isolado · modelo externo":"Template isolado · runtime configurável",
    language:"python",
    fileName:cleanId(engine.id)+".py",
    source
  };
}
