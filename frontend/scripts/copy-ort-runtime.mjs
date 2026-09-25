import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const here=path.dirname(fileURLToPath(import.meta.url));
const frontend=path.resolve(here,"..");
const source=path.join(frontend,"node_modules","onnxruntime-web","dist");
const target=path.join(frontend,"public","ort");
const files=[
  "ort-wasm-simd-threaded.wasm",
  "ort-wasm-simd-threaded.mjs",
  "ort-wasm-simd-threaded.jsep.wasm",
  "ort-wasm-simd-threaded.jsep.mjs"
];

fs.mkdirSync(target,{recursive:true});
for(const name of files){
  const from=path.join(source,name),to=path.join(target,name);
  if(!fs.existsSync(from))throw new Error("ONNX Runtime asset missing: "+from);
  fs.copyFileSync(from,to);
}
console.log("Copied ONNX Runtime Web assets:",files.join(", "));
