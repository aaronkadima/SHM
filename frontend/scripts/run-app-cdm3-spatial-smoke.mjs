#!/usr/bin/env node
import{spawn}from"node:child_process";
import{rm}from"node:fs/promises";
const chrome=process.env.CHROME_BIN||process.argv[2];
const targetUrl=process.env.APP_SMOKE_URL||"http://127.0.0.1:4181/#/analysis";
const port=Number(process.env.APP_SMOKE_DEBUG_PORT||9235);
if(!chrome)throw new Error("Chrome/Chromium executable was not provided.");
const profile="/tmp/shm-cdm3-spatial-smoke-"+process.pid;
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
  await waitUntil(request,'document.readyState==="complete"&&location.hash==="#/analysis"&&!!document.querySelector(".analysisEditor")&&!!document.querySelector(\'.editorTopActions input[type="file"]\')',"analysis workspace with spatial file input");
  await evaluate(request,'(()=>{const input=document.querySelector(\'.editorTopActions input[type="file"]\');if(!input)throw new Error("analysis file input not found at "+location.href+" body="+document.body?.innerText?.slice(0,300));const xyz=["100 200 10","101 200 10.5","102 201 11","103 202 12","104 203 12.5"].join("\\n");const file=new File([xyz],"cdm3-spatial-smoke.xyz",{type:"text/plain"});const dt=new DataTransfer();dt.items.add(file);input.files=dt.files;input.dispatchEvent(new Event("change",{bubbles:true}));return true})()');
  await waitUntil(request,'(()=>{const badge=document.querySelector(".editorTypeBadge")?.textContent||"";const engine=document.querySelector(".editorEngineState")?.textContent||"";const button=document.querySelector(".editorPrimary");return badge.includes("CDM-3 espacial")&&engine.includes("CDM-3")&&!!button&&!button.disabled})()',"CDM-3 spatial asset ready");
  await evaluate(request,'(()=>{document.querySelector(".editorPrimary")?.click();return true})()');
  const state=await waitUntil(request,'(()=>{const row=document.querySelector(".editorResultRow");const title=[...document.querySelectorAll(".editorCdmTitle")].map(x=>x.textContent||"").find(x=>x.includes("CDM-3 · ativo espacial"))||"";const progress=document.querySelector(".editorProgress");const model=document.querySelector(".modelViewport");const status=document.querySelector(".editorStatusMessage")?.textContent?.trim()||"";if(row&&title&&!progress&&model)return {row:row.textContent?.trim()||"",title,status,badge:document.querySelector(".editorTypeBadge")?.textContent?.trim()||"",engine:document.querySelector(".editorEngineState")?.textContent?.trim()||""};return null})()',"CDM-3 spatial result",60000);
  if(!String(state.row||"").includes("Pontos5"))throw new Error("Spatial result did not report 5 points: "+JSON.stringify(state));
  if(!state.badge.includes("CDM-3 espacial"))throw new Error("Spatial badge missing: "+JSON.stringify(state));
  if(!state.engine.includes("CDM-3"))throw new Error("CDM-3 was not auto-selected: "+JSON.stringify(state));
  console.log("APP_CDM3_SPATIAL_SMOKE_PASS",JSON.stringify(state));
}finally{try{ws?.close()}catch{}if(child.exitCode==null)child.kill("SIGTERM");await sleep(250);if(child.exitCode==null)child.kill("SIGKILL");await rm(profile,{recursive:true,force:true}).catch(()=>{})}
