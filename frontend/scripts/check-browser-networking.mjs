import fs from "node:fs";

const settings=fs.readFileSync(new URL("../src/AnalysisSettings.jsx",import.meta.url),"utf8");
const onnx=fs.readFileSync(new URL("../src/onnxBrowser.js",import.meta.url),"utf8");
const workspace=fs.readFileSync(new URL("../src/AnalysisWorkspace.jsx",import.meta.url),"utf8");
const pkg=JSON.parse(fs.readFileSync(new URL("../package.json",import.meta.url),"utf8"));

const failures=[];
const check=(ok,msg)=>{if(!ok)failures.push(msg)};

check(pkg.dependencies?.["onnxruntime-web"]==="1.30.0","onnxruntime-web must remain pinned to 1.30.0");
check(onnx.includes('import * as bundledOrt from "onnxruntime-web";'),"ONNX runtime must be bundled through npm");
check(onnx.includes("ort.env.wasm.wasmPaths=ortAssetBase()"),"WASM path must point to same-origin /ort assets");
check(!onnx.includes("cdn.jsdelivr.net"),"ONNX browser runtime must not depend on jsDelivr");
check(!onnx.includes("raw.githubusercontent.com/aaronkadima/SHM/"),"ONNX inference must not depend on GitHub raw");
check(settings.includes("https://raw.githubusercontent.com/aaronkadima/SHM/"),"engine update check must retain raw GitHub primary source");
check(settings.includes("https://api.github.com/repos/aaronkadima/SHM/contents/"),"engine update check must include GitHub API fallback");
check(!settings.includes('headers:{"Cache-Control":"no-cache"}'),"engine update check must not force CORS preflight with Cache-Control");
check(settings.includes('credentials:"omit"'),"engine update check must omit credentials for public GitHub requests");
check(workspace.includes('for(const row of rows)next[row.engine_id]=true'),"fresh analysis results must force engine layers visible");
check(workspace.includes('?"overlay":current'),"fresh overlay results must become visible when viewer was on Original");

if(failures.length){
  console.error("Browser networking/result regressions:");
  failures.forEach(x=>console.error(" - "+x));
  process.exit(1);
}
console.log("Browser networking/results passed:",{
  ort:"same-origin npm+wasm",
  updateCheck:"raw+api fallback without forced preflight",
  resultReveal:"visible+overlay"
});
