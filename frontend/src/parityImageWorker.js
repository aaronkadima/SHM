// Worker da "Paridade desta imagem": gera variações da imagem analisada, roda o cdm_v285.py
// (Python via Pyodide) e o cdmBrowser.js (JavaScript) em cada uma e calcula os mesmos
// indicadores do relatório do CI. Tudo fora da thread da interface.
import cdmSource from "../../backend/app/cdm_v285.py?raw";
import {buildParityReport} from "./parityMetrics.js";
import {cdmConfig} from "./cdmBrowser.js";
import {PYODIDE_INDEX_URL,PYODIDE_VERSION,preparePyodide,runPythonCase} from "./parityPyDriver.js";

const MAX_SIDE=384;
let pyReady=null;
const post=(type,data)=>self.postMessage({type,...data});

async function getPython(){
  if(!pyReady)pyReady=(async()=>{
    post("progress",{phase:"pyodide",label:"Carregando Python (Pyodide "+PYODIDE_VERSION+") , numpy, Pillow e lxml — só na primeira vez",done:0,total:1});
    const {loadPyodide}=await import(/* @vite-ignore */ PYODIDE_INDEX_URL+"pyodide.mjs");
    const py=await loadPyodide({indexURL:PYODIDE_INDEX_URL});
    const parityCase=await preparePyodide(py,cdmSource);
    return{py,parityCase,version:py.runPython("import sys, numpy; sys.version.split()[0] + ' · numpy ' + numpy.__version__")};
  })().catch(e=>{pyReady=null;throw e});
  return pyReady;
}

// ---------- variações determinísticas da imagem ----------
function canvas(w,h){const c=new OffscreenCanvas(w,h);return[c,c.getContext("2d",{willReadFrequently:true})]}
function grab(source,sx,sy,sw,sh,dw,dh){const[c,ctx]=canvas(dw,dh);ctx.imageSmoothingQuality="high";ctx.drawImage(source,sx,sy,sw,sh,0,0,dw,dh);return ctx.getImageData(0,0,dw,dh)}
function mapPixels(img,fn){const out=new ImageData(img.width,img.height),s=img.data,d=out.data;for(let i=0;i<s.length;i+=4){d[i]=fn(s[i],i);d[i+1]=fn(s[i+1],i+1);d[i+2]=fn(s[i+2],i+2);d[i+3]=255}return out}
const clamp8=v=>v<0?0:v>255?255:Math.round(v);
function rotate(img,turns){
  const{width:w,height:h,data:s}=img,W=turns%2?h:w,H=turns%2?w:h,out=new ImageData(W,H),d=out.data;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){let X,Y;if(turns===1){X=h-1-y;Y=x}else if(turns===2){X=w-1-x;Y=h-1-y}else{X=y;Y=w-1-x}const a=(y*w+x)*4,b=(Y*W+X)*4;d[b]=s[a];d[b+1]=s[a+1];d[b+2]=s[a+2];d[b+3]=255}
  return out;
}
function flip(img,horizontal){const{width:w,height:h,data:s}=img,out=new ImageData(w,h),d=out.data;for(let y=0;y<h;y++)for(let x=0;x<w;x++){const X=horizontal?w-1-x:x,Y=horizontal?y:h-1-y,a=(y*w+x)*4,b=(Y*w+X)*4;d[b]=s[a];d[b+1]=s[a+1];d[b+2]=s[a+2];d[b+3]=255}return out}
function crop(img,x0,y0,cw,ch){const out=new ImageData(cw,ch);for(let y=0;y<ch;y++)out.data.set(img.data.subarray(((y0+y)*img.width+x0)*4,((y0+y)*img.width+x0+cw)*4),y*cw*4);return out}
function noise(img,sigma,seed){let st=seed>>>0;const rnd=()=>{st=(st*1664525+1013904223)>>>0;return st/4294967296};const gauss=()=>Math.sqrt(-2*Math.log(Math.max(1e-9,rnd())))*Math.cos(2*Math.PI*rnd());return mapPixels(img,v=>clamp8(v+sigma*gauss()))}
async function jpeg(img,quality){const[c,ctx]=canvas(img.width,img.height);ctx.putImageData(img,0,0);const blob=await c.convertToBlob({type:"image/jpeg",quality});const bmp=await createImageBitmap(blob);return grab(bmp,0,0,bmp.width,bmp.height,bmp.width,bmp.height)}

async function makeVariants(file){
  const bmp=await createImageBitmap(file,{imageOrientation:"from-image"});
  const k=Math.min(1,MAX_SIDE/Math.max(bmp.width,bmp.height)),w=Math.max(16,Math.round(bmp.width*k)),h=Math.max(16,Math.round(bmp.height*k));
  const base=grab(bmp,0,0,bmp.width,bmp.height,w,h),cw=Math.round(w*.7),ch=Math.round(h*.7);
  const fromBitmap=(sx,sy,sw,sh)=>grab(bmp,sx*bmp.width,sy*bmp.height,sw*bmp.width,sh*bmp.height,Math.max(16,Math.round(sw*bmp.width*k)),Math.max(16,Math.round(sh*bmp.height*k)));
  const list=[
    ["original","Original (≤"+MAX_SIDE+" px)",()=>base],
    ["recorte_se","Recorte 70% · sup. esq.",()=>crop(base,0,0,cw,ch)],
    ["recorte_sd","Recorte 70% · sup. dir.",()=>crop(base,w-cw,0,cw,ch)],
    ["recorte_ie","Recorte 70% · inf. esq.",()=>crop(base,0,h-ch,cw,ch)],
    ["recorte_id","Recorte 70% · inf. dir.",()=>crop(base,w-cw,h-ch,cw,ch)],
    ["zoom_centro","Zoom 1,6× no centro",()=>fromBitmap(.2,.2,.6,.6)],
    ["fase_7_5","Deslocamento de grade (7, 5 px)",()=>crop(base,7,5,w-7,h-5)],
    ["escala_75","Escala 75%",()=>grab(bmp,0,0,bmp.width,bmp.height,Math.round(w*.75),Math.round(h*.75))],
    ["escala_50","Escala 50%",()=>grab(bmp,0,0,bmp.width,bmp.height,Math.round(w*.5),Math.round(h*.5))],
    ["rot_90","Rotação 90°",()=>rotate(base,1)],
    ["rot_180","Rotação 180°",()=>rotate(base,2)],
    ["rot_270","Rotação 270°",()=>rotate(base,3)],
    ["espelho_h","Espelho horizontal",()=>flip(base,true)],
    ["espelho_v","Espelho vertical",()=>flip(base,false)],
    ["brilho_p15","Brilho +15",()=>mapPixels(base,v=>clamp8(v+15))],
    ["brilho_m15","Brilho −15",()=>mapPixels(base,v=>clamp8(v-15))],
    ["contraste_115","Contraste 1,15",()=>mapPixels(base,v=>clamp8((v-128)*1.15+128))],
    ["contraste_085","Contraste 0,85",()=>mapPixels(base,v=>clamp8((v-128)*.85+128))],
    ["gama_08","Gama 0,8",()=>mapPixels(base,v=>clamp8(255*(v/255)**.8))],
    ["gama_125","Gama 1,25",()=>mapPixels(base,v=>clamp8(255*(v/255)**1.25))],
    ["jpeg_85","JPEG qualidade 85",()=>jpeg(base,.85)],
    ["jpeg_60","JPEG qualidade 60",()=>jpeg(base,.6)],
    ["ruido_3","Ruído gaussiano σ 3",()=>noise(base,3,11)],
    ["ruido_6","Ruído gaussiano σ 6",()=>noise(base,6,29)],
  ];
  const out=[];
  try{for(const[id,label,make]of list){const img=await make();out.push({name:id,label,width:img.width,height:img.height,rgba:new Uint8ClampedArray(img.data.buffer.slice(0))})}}
  finally{bmp.close?.()}
  return{variants:out,source:{width:w,height:h}};
}

self.onmessage=async e=>{
  const{type,file,options,fileName}=e.data||{};
  if(type!=="run")return;
  const started=performance.now();
  try{
    post("progress",{phase:"variants",label:"Gerando variações da imagem",done:0,total:1});
    const{variants,source}=await makeVariants(file);
    const{parityCase,version}=await getPython();
    const cfg=cdmConfig(options||{}),cases=[];
    let order=null;
    for(let i=0;i<variants.length;i++){
      const v=variants[i];
      post("progress",{phase:"python",label:"Python (cdm_v285.py) · "+v.label,done:i,total:variants.length});
      const c=runPythonCase(parityCase,v,cfg);order=order||c.classesOrder;
      cases.push({...c,name:v.name+" · "+v.label});
    }
    post("progress",{phase:"compare",label:"Comparando com o JavaScript (cdmBrowser.js)",done:variants.length,total:variants.length});
    const report=buildParityReport({config:cfg,classes:order,python:{pyodide:PYODIDE_VERSION,version},cases},{
      source:"image",onlyPresent:true,node:null,
      runtimes:{pyodide:PYODIDE_VERSION,python_runtime:version,browser:self.navigator?.userAgent||null},
      image:{name:fileName||file?.name||"imagem",analyzed_width:source.width,analyzed_height:source.height,variants:variants.length,elapsed_ms:Math.round(performance.now()-started)},
    });
    report.generated_at=new Date().toISOString();
    post("done",{report});
  }catch(err){
    const msg=String(err?.message||err);
    post("error",{message:/dynamically imported module|pyodide\.mjs|Failed to fetch|NetworkError|fetch failed/i.test(msg)?"não foi possível baixar o Python (Pyodide) da CDN cdn.jsdelivr.net — verifique a conexão ou se a rede bloqueia esse endereço. ("+msg+")":msg});
  }
};
