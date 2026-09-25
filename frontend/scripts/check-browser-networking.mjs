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
check(settings.includes('base+"build.json"'),"engine update check must verify same-origin deployment build");
check(settings.includes('base+"browser-models/"+encodeURIComponent(engine.browser_manifest_asset)'),"browser engines must verify their same-origin published manifest");
check(settings.includes('credentials:"same-origin"'),"engine update check must stay same-origin and avoid public GitHub CORS dependencies");
check(!settings.includes("raw.githubusercontent.com/aaronkadima/SHM/")&&!settings.includes("api.github.com/repos/aaronkadima/SHM/contents/"),"engine update check must not depend on cross-origin GitHub raw/API requests");
check(onnx.includes('+"?sha256="+expectedSha'),"ONNX model URLs must be versioned by manifest SHA-256 to avoid stale browser caches");
check(onnx.includes('const key=base+":"+stem+":"+expectedSha'),"ONNX session cache must be keyed by the published model SHA-256");
check(workspace.includes('for(const row of rows)next[row.engine_id]=true'),"fresh analysis results must force engine layers visible");
check(workspace.includes('resultOpenPreference.current=true')&&workspace.includes('setResultOpen(true)'),"fresh analysis results must reopen the results panel");
check(workspace.includes('?"overlay":current'),"fresh overlay results must become visible when viewer was on Original");
check(workspace.includes('Área fissura'),"semantic segmentation results must expose crack-area percentage in the results panel");

if(failures.length){
  console.error("Browser networking/result regressions:");
  failures.forEach(x=>console.error(" - "+x));
  process.exit(1);
}
console.log("Browser networking/results passed:",{
  ort:"same-origin npm+wasm",
  updateCheck:"same-origin build+manifest",
  modelCache:"manifest-sha-versioned",
  resultReveal:"visible+overlay+panel+area"
});
