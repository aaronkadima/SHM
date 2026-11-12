// CI: valida a ponte Pyodide da "Paridade desta imagem" em Node.
// Roda o cdm_v285.py dentro do Pyodide (mesma versão e mesmo driver do navegador) sobre algumas
// cenas e compara com o cdmBrowser.js pelos indicadores do relatório.
// Uso: npm i --no-save pyodide@<versão> && node scripts/check-pyodide-parity.mjs CASOS.json
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {loadPyodide} from "pyodide";
import {PYODIDE_VERSION,PYODIDE_INDEX_URL,preparePyodide,runPythonCase} from "../src/parityPyDriver.js";
import {buildParityReport} from "../src/parityMetrics.js";
import {cdmConfig} from "../src/cdmBrowser.js";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../..");
const casesPath=process.argv[2];
if(!casesPath)throw new Error("usage: node scripts/check-pyodide-parity.mjs CASES.json");
const input=JSON.parse(fs.readFileSync(casesPath,"utf8"));
const t0=Date.now();
const py=await loadPyodide({packageBaseUrl:PYODIDE_INDEX_URL});
const parityCase=await preparePyodide(py,fs.readFileSync(path.join(root,"backend/app/cdm_v285.py"),"utf8"));
console.log(`Pyodide ${PYODIDE_VERSION} pronto em ${((Date.now()-t0)/1000).toFixed(1)} s · ${py.runPython("import sys, numpy; sys.version.split()[0] + ' numpy ' + numpy.__version__")}`);
// mesma configuração que o navegador deriva das opções do usuário
const cfg={...cdmConfig({cdm_threshold:input.config.threshold,cdm_kernel_size:input.config.kernel,cdm_min_area:input.config.minArea,cdm_min_aspect_ratio:input.config.minAspect})};
const picked=input.cases.slice(0,5),cases=[];let order=null;
for(const c of picked){
  const n=c.width*c.height,rgba=new Uint8ClampedArray(n*4);
  for(let i=0,j=0;i<n;i++,j+=3){rgba[i*4]=c.rgb[j];rgba[i*4+1]=c.rgb[j+1];rgba[i*4+2]=c.rgb[j+2];rgba[i*4+3]=255}
  const t=Date.now(),pc=runPythonCase(parityCase,{name:c.name,width:c.width,height:c.height,rgba},cfg);order=order||pc.classesOrder;
  console.log(`  ${c.name} ${c.width}×${c.height}: ${Date.now()-t} ms`);
  cases.push(pc);
}
const report=buildParityReport({config:cfg,classes:order,python:{pyodide:PYODIDE_VERSION},cases},{source:"pyodide_ci"});
for(const t of report.tolerances)console.log(`${t.pass?"✓":"✗"} ${t.label}: ${t.value} (${t.rule} ${t.limit})`);
if(report.status!=="pass"){console.error("Pyodide parity FAILED: "+report.status);process.exit(1)}
console.log("Pyodide (cdm_v285.py) ⇄ browser parity passed.");
