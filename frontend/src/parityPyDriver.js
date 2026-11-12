// Ponte Pyodide ⇄ cdm_v285.py para a paridade da imagem analisada.
// Usado no navegador (parityImageWorker.js) e no CI em Node (scripts/check-pyodide-parity.mjs).
// O Python roda só com numpy: a morfologia cai no caminho de janela deslizante do próprio
// cdm_v285 (sem scipy/Pillow), que dá o mesmo resultado do caminho scipy usado no CI.

export const PYODIDE_VERSION="314.0.7";
export const PYODIDE_INDEX_URL=`https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;

export const PY_DRIVER=`
import sys, numpy as np
if "/home/pyodide" not in sys.path:
    sys.path.insert(0, "/home/pyodide")
import cdm_v285 as cdm
cdm._HAVE_SCIPY = False
cdm.ImageFilter = None

def _f32(a):
    return np.ascontiguousarray(a, dtype=np.float32).tobytes()

def _u8(a):
    return np.ascontiguousarray(a, dtype=np.uint8).tobytes()

def parity_case(rgb_js, w, h, threshold, kernel, min_area, min_aspect):
    rgb = np.frombuffer(bytes(rgb_js.to_py()), dtype=np.uint8).reshape(int(h), int(w), 3).copy()
    cfg = cdm.DetectorConfig(threshold=int(round(threshold)), kernel_size=int(kernel), min_area=float(min_area), min_aspect_ratio=float(min_aspect))
    masks, pipe = cdm.detect_masks(rgb, cfg)
    classes = {}
    for cls in cdm.PATHOLOGY_FAMILY_ORDER:
        st = pipe[cls]
        recs = cdm.records_from_mask(masks[cls], cls, "t1_current", cfg)
        classes[cls] = {
            "response": _f32(st["response"]),
            "raw_mask": _u8(st["raw_mask"]),
            "open_mask": _u8(st["open_mask"]),
            "clean_mask": _u8(st["clean_mask"]),
            "final_mask": _u8(masks[cls]),
            "records": [{"bbox": [int(v) for v in r.bbox], "area": float(r.area_px2), "length": float(r.length_px), "width": float(r.width_px)} for r in recs],
        }
    frag = cdm.crack_fragments(masks["cracks"].astype(bool), max(1.0, float(cfg.min_area)))
    bridged = cdm.close_bool(frag, cdm.CRACK_BRIDGE_KERNEL) | frag
    skel = cdm.prune_spurs(cdm.zhang_suen(bridged))
    return {"gray": _f32(pipe["gray"]), "classes": classes, "crack_skeleton": _u8(skel), "classes_order": list(cdm.PATHOLOGY_FAMILY_ORDER)}
`;

// Prepara o interpretador: numpy + módulo cdm_v285.py no sistema de arquivos virtual.
export async function preparePyodide(py,cdmSource){
  await py.loadPackage("numpy");
  py.FS.mkdirTree("/home/pyodide");
  py.FS.writeFile("/home/pyodide/cdm_v285.py",cdmSource);
  py.runPython(PY_DRIVER);
  return py.globals.get("parity_case");
}

const asBytes=v=>v instanceof Uint8Array?v:new Uint8Array(v);
const asF32=v=>{const b=asBytes(v);return new Float32Array(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength))};

// Roda uma variação no Python e devolve o caso no formato de buildParityReport.
export function runPythonCase(parityCase,{name,width,height,rgba},cfg){
  const n=width*height,rgb=new Uint8Array(n*3);
  for(let i=0,j=0;i<n;i++,j+=3){rgb[j]=rgba[i*4];rgb[j+1]=rgba[i*4+1];rgb[j+2]=rgba[i*4+2]}
  const proxy=parityCase(rgb,width,height,cfg.threshold,cfg.kernel,cfg.minArea,cfg.minAspect);
  let out;try{out=proxy.toJs({dict_converter:Object.fromEntries})}finally{proxy.destroy?.()}
  const classes={};
  for(const[cls,c]of Object.entries(out.classes))classes[cls]={response:asF32(c.response),raw_mask:asBytes(c.raw_mask),open_mask:asBytes(c.open_mask),clean_mask:asBytes(c.clean_mask),final_mask:asBytes(c.final_mask),records:c.records};
  return{name,width,height,rgba,python:{gray:asF32(out.gray),classes,crack_skeleton:asBytes(out.crack_skeleton)},classesOrder:out.classes_order};
}
