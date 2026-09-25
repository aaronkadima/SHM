#!/usr/bin/env node
import{spawn}from"node:child_process";
import{rm}from"node:fs/promises";
const chrome=process.env.CHROME_BIN||process.argv[2];
const targetUrl=process.env.APP_SMOKE_URL||"http://127.0.0.1:4181/#/analysis";
const port=Number(process.env.APP_SMOKE_DEBUG_PORT||9236);
if(!chrome)throw new Error("Chrome/Chromium executable was not provided.");
const profile="/tmp/shm-cdm3-rgb-registration-smoke-"+process.pid;
const child=spawn(chrome,["--headless=new","--no-sandbox","--disable-gpu","--disable-dev-shm-usage","--remote-debugging-address=127.0.0.1","--remote-debugging-port="+port,"--user-data-dir="+profile,"--window-size=1280,800",targetUrl],{stdio:["ignore","ignore","pipe"]});
let chromeErr="";child.stderr.on("data",chunk=>{chromeErr=(chromeErr+chunk.toString()).slice(-12000)});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function json(url){const response=await fetch(url,{cache:"no-store"});if(!response.ok)throw new Error("HTTP "+response.status+" "+url);return response.json()}
async function waitTarget(){const deadline=Date.now()+30000;while(Date.now()<deadline){const list=await json("http://127.0.0.1:"+port+"/json/list").catch(()=>[]);const target=list.find(x=>x.type==="page"&&x.webSocketDebuggerUrl);if(target)return target;await sleep(250)}throw new Error("Timed out waiting for Chrome DevTools target. "+chromeErr)}
function connect(wsUrl){return new Promise((resolve,reject)=>{const ws=new WebSocket(wsUrl);ws.addEventListener("open",()=>resolve(ws),{once:true});ws.addEventListener("error",()=>reject(new Error("Could not connect to Chrome DevTools WebSocket.")),{once:true})})}
function cdp(ws){let id=0;const pending=new Map();ws.addEventListener("message",event=>{let msg;try{msg=JSON.parse(String(event.data))}catch{return}if(!msg.id)return;const item=pending.get(msg.id);if(!item)return;pending.delete(msg.id);if(msg.error)item.reject(new Error(msg.error.message||"CDP error"));else item.resolve(msg.result)});return(method,params={})=>new Promise((resolve,reject)=>{const requestId=++id;pending.set(requestId,{resolve,reject});ws.send(JSON.stringify({id:requestId,method,params}))})}
async function evaluate(request,expression){const result=await request("Runtime.evaluate",{expression,returnByValue:true,awaitPromise:true});if(result?.exceptionDetails){const description=result.exceptionDetails.exception?.description||result.exceptionDetails.text||"Runtime evaluation failed";throw new Error(String(description))}return result?.result?.value}
async function waitUntil(request,expression,label,timeout=30000){const deadline=Date.now()+timeout;let last=null;while(Date.now()<deadline){last=await evaluate(request,expression);if(last)return last;await sleep(250)}throw new Error("Timed out waiting for "+label+". Last="+JSON.stringify(last))}
let ws;
try{
  const target=await waitTarget();ws=await connect(target.webSocketDebuggerUrl);const request=cdp(ws);await request("Runtime.enable");await request("Page.enable");
  await waitUntil(request,'document.readyState==="complete"&&location.hash==="#/analysis"&&!!document.querySelector(".analysisEditor")',"analysis workspace");
  await evaluate(request,'(()=>{const input=document.querySelectorAll(\'.editorTopActions input[type="file"]\')[0];if(!input)throw new Error("main file input missing");const xyz=["0 0 0","1 0 0","1 1 0","0 1 0","0.5 0.5 1","1.5 0.5 0.2"].join("\\n");const file=new File([xyz],"cdm3-no-rgb.xyz",{type:"text/plain"});const dt=new DataTransfer();dt.items.add(file);input.files=dt.files;input.dispatchEvent(new Event("change",{bubbles:true}));return true})()');
  await waitUntil(request,'(()=>{const badge=document.querySelector(".editorTypeBadge")?.textContent||"";const actions=document.querySelector(".editorTopActions")?.textContent||"";return badge.includes("CDM-3 espacial")&&actions.includes("Imagem RGB")})()',"external RGB action");
  await evaluate(request,'(async()=>{const inputs=document.querySelectorAll(\'.editorTopActions input[type="file"]\');const input=inputs[2];if(!input)throw new Error("spatial RGB input missing; count="+inputs.length);const canvas=document.createElement("canvas");canvas.width=8;canvas.height=8;const ctx=canvas.getContext("2d");ctx.fillStyle="#785a42";ctx.fillRect(0,0,8,8);ctx.fillStyle="#d8d0bd";ctx.fillRect(1,1,6,2);ctx.fillStyle="#3e5f6e";ctx.fillRect(2,4,4,3);const blob=await new Promise(resolve=>canvas.toBlob(resolve,"image/png"));if(!blob)throw new Error("could not create RGB fixture");const file=new File([blob],"bridge-frame.png",{type:"image/png"});const dt=new DataTransfer();dt.items.add(file);input.files=dt.files;input.dispatchEvent(new Event("change",{bubbles:true}));return true})()');
  await waitUntil(request,'(()=>{const preview=document.querySelector(".spatialRgbPreview");const layer=document.querySelector(".spatialRgbLayer");const actions=document.querySelector(".editorTopActions")?.textContent||"";return !!preview&&!!layer&&actions.includes("RGB: bridge-frame.png")})()',"linked external RGB source");
  await waitUntil(request,'(()=>{const b=document.querySelector(".editorPrimary");return !!b&&!b.disabled})()',"CDM-3 analyze button");
  await evaluate(request,'(()=>{document.querySelector(".editorPrimary")?.click();return true})()');
  const state=await waitUntil(request,'(()=>{const summary=document.querySelector(".editorCdmSummary")?.textContent||"";const row=document.querySelector(".editorResultRow")?.textContent||"";const progress=document.querySelector(".editorProgress");if(!progress&&summary.includes("bridge-frame.png")&&summary.includes("PnP/RANSAC pendente"))return {summary,row,preview:!!document.querySelector(".spatialRgbPreview"),layer:!!document.querySelector(".spatialRgbLayer")};return null})()',"CDM-3 external RGB registration result",60000);
  if(!state.preview||!state.layer)throw new Error("External RGB source disappeared: "+JSON.stringify(state));
  if(!state.summary.includes("RGB externo"))throw new Error("External RGB metric missing: "+JSON.stringify(state));
  if(!state.summary.includes("PnP/RANSAC pendente"))throw new Error("Registration state missing: "+JSON.stringify(state));
  console.log("APP_CDM3_RGB_REGISTRATION_SMOKE_PASS",JSON.stringify(state));
}finally{try{ws?.close()}catch{}if(child.exitCode==null)child.kill("SIGTERM");await sleep(250);if(child.exitCode==null)child.kill("SIGKILL");await rm(profile,{recursive:true,force:true}).catch(()=>{})}
