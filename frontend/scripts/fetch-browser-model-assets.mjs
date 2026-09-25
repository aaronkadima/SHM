#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";

function arg(name, fallback=null){
  const index=process.argv.indexOf("--"+name);
  return index>=0?process.argv[index+1]:fallback;
}
const tag=arg("tag"),repo=arg("repo")||process.env.GITHUB_REPOSITORY,engine=arg("engine"),variant=arg("variant",""),outDir=path.resolve(arg("dir","public/browser-models"));
const withParity=process.argv.includes("--parity");
const attempts=Math.max(1,Number(arg("attempts","12")));
const delayMs=Math.max(0,Number(arg("delay-ms","3000")));
if(!tag||!repo||!engine)throw new Error("Usage: fetch-browser-model-assets.mjs --tag <tag> --repo <owner/repo> --engine <id> [--variant int8] [--parity] [--dir path]");

const stem=variant?engine+"."+variant:engine;
const modelName=stem+".onnx",manifestName=stem+".json";
const parityStem=variant?engine+"."+variant+".parity":engine+".parity";
const parityJsonName=parityStem+".json",parityPngName=parityStem+".png";
const patterns=[modelName,manifestName,...(withParity?[parityJsonName,parityPngName]:[])];

function sleep(ms){return new Promise(resolve=>setTimeout(resolve,ms))}
function sha256(file){return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex")}
function readJson(file){return JSON.parse(fs.readFileSync(file,"utf8"))}
function validate(dir){
  const modelPath=path.join(dir,modelName),manifestPath=path.join(dir,manifestName);
  for(const name of patterns)if(!fs.existsSync(path.join(dir,name)))throw new Error("missing asset "+name);
  const manifest=readJson(manifestPath);
  if(manifest.engine_id!==engine)throw new Error("manifest engine_id mismatch");
  const size=fs.statSync(modelPath).size;
  if(Number(manifest.bytes)!==size)throw new Error("model size mismatch");
  const digest=sha256(modelPath);
  if(String(manifest.sha256||"").toLowerCase()!==digest)throw new Error("model SHA-256 mismatch");
  if(withParity){
    const parity=readJson(path.join(dir,parityJsonName));
    if(parity.engine_id!==engine)throw new Error("parity engine_id mismatch");
    const fixtureDigest=sha256(path.join(dir,parityPngName));
    if(String(parity.fixture_sha256||"").toLowerCase()!==fixtureDigest)throw new Error("parity fixture SHA-256 mismatch");
  }
  return{bytes:size,sha256:digest};
}

let lastError=null;
for(let attempt=1;attempt<=attempts;attempt++){
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),"shm-browser-assets-"));
  try{
    const args=["release","download",tag,"--repo",repo,"--dir",tmp,...patterns.flatMap(name=>["--pattern",name])];
    const result=spawnSync("gh",args,{encoding:"utf8"});
    if(result.status!==0)throw new Error((result.stderr||result.stdout||"gh release download failed").trim());
    const validated=validate(tmp);

    fs.mkdirSync(outDir,{recursive:true});
    for(const name of patterns){
      const source=path.join(tmp,name),target=path.join(outDir,name),staged=target+".partial";
      fs.copyFileSync(source,staged);
      fs.renameSync(staged,target);
    }
    console.log(JSON.stringify({status:"ok",tag,engine,variant:variant||null,attempt,assets:patterns,bytes:validated.bytes,sha256:validated.sha256},null,2));
    fs.rmSync(tmp,{recursive:true,force:true});
    process.exit(0);
  }catch(error){
    lastError=error;
    fs.rmSync(tmp,{recursive:true,force:true});
    console.warn("Browser model asset set not stable yet (attempt "+attempt+"/"+attempts+"): "+(error?.message||String(error)));
    if(attempt<attempts)await sleep(delayMs);
  }
}
throw lastError||new Error("Unable to fetch a coherent browser model asset set.");
