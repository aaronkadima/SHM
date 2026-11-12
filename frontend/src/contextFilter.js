// Filtro de contexto por IA para o CDM (sem DOM: roda na página, no cdmWorker ou no liveWorker).
//
// Um SegFormer-B0 treinado no ADE20K (150 classes de cena) classifica cada região da foto.
// O CDM continua determinístico e roda na imagem inteira; DEPOIS, cada componente conexo de
// cada camada de patologia é descartado se a maior parte dele cair numa região irrelevante
// (céu, vegetação, solo, água, veículos, pessoas, placas, postes…). Assim:
//   · nenhuma borda artificial é criada (zerar pixels antes geraria "fissuras" no recorte);
//   · as medidas e a paridade JS ⇄ Python do CDM não mudam;
//   · a IA só remove falsos positivos — nunca cria patologia.
export const CONTEXT_ENGINE_ID="segformer_ade_context";
export const CONTEXT_MODES={off:"Desligado",conservative:"Conservador",strict:"Estrito"};
export const DEFAULT_CONTEXT_SHARE=.6;

// Classes ADE20K (nomes do id2label) — grupos usados pelo filtro.
const EXCLUDE=["sky","tree","grass","plant","flower","palm","field","earth","land","sand","mountain","hill","dirt track",
  "water","sea","river","lake","waterfall","fountain","swimming pool","person","animal","car","truck","bus","van","boat","ship",
  "airplane","bicycle","minibike","signboard","trade name","poster","painting","flag","streetlight","traffic light","pole",
  "awning","canopy","tent","apparel","bag","ashcan","bulletin board"];
const STRUCTURE=["wall","building","floor","ceiling","road","sidewalk","path","runway","column","pier","bridge","stairs","stairway",
  "step","railing","bannister","fence","base","tower","skyscraper","house","hovel","grandstand","stage","rock","countertop"];
// Nomes em português das classes ADE20K mais comuns em inspeção (as demais ficam em inglês).
export const ADE_PT={wall:"parede",building:"edificação",sky:"céu",floor:"piso",tree:"árvore",ceiling:"teto",road:"pista/via",grass:"grama",
  sidewalk:"calçada",person:"pessoa",earth:"solo",door:"porta",mountain:"montanha",plant:"vegetação",car:"carro",water:"água",painting:"pintura/quadro",
  house:"casa",sea:"mar",field:"campo",fence:"cerca",rock:"rocha",railing:"guarda-corpo",base:"base",column:"pilar/coluna",signboard:"placa",
  sand:"areia",skyscraper:"edifício alto",path:"caminho",stairs:"escada",runway:"pista",river:"rio",bridge:"ponte",flower:"flor",hill:"morro",
  palm:"palmeira",boat:"barco",bus:"ônibus",truck:"caminhão",tower:"torre",streetlight:"poste de iluminação",airplane:"avião","dirt track":"estrada de terra",
  pole:"poste",land:"terreno",bannister:"corrimão",poster:"cartaz",van:"van",ship:"navio",fountain:"fonte",canopy:"cobertura",tent:"tenda",
  stairway:"escadaria",step:"degrau",animal:"animal",bicycle:"bicicleta",lake:"lago",minibike:"moto","traffic light":"semáforo",pier:"cais/píer",
  flag:"bandeira",awning:"toldo","trade name":"letreiro",apparel:"roupa",bag:"bolsa",ashcan:"lixeira","bulletin board":"mural",window:"janela",
  windowpane:"vidraça",grandstand:"arquibancada",stage:"palco",countertop:"bancada",waterfall:"cachoeira","swimming pool":"piscina",hovel:"barraco"};
export const ptLabel=name=>ADE_PT[name]||name||"—";
const norm=s=>String(s||"").toLowerCase().split(/[,;]/)[0].trim();

export function contextGroups(labels){
  const entries=Object.entries(labels||{}).map(([k,v])=>[Number(k),norm(v)]).filter(([k])=>Number.isFinite(k));
  const n=entries.reduce((m,[k])=>Math.max(m,k+1),0);
  const group=new Uint8Array(n);// 0 neutro · 1 estrutura · 2 irrelevante
  const names=new Array(n).fill("");
  for(const[k,name]of entries){names[k]=name;group[k]=STRUCTURE.includes(name)?1:EXCLUDE.includes(name)?2:0}
  return{group,names};
}

// Redimensiona RGBA (caixa/vizinho) para a entrada do modelo e normaliza (ImageNet, CHW).
function tensorFromRgba(img,tw,th,manifest){
  const{width:w,height:h,data}=img,n=tw*th,out=new Float32Array(3*n);
  const f=Number(manifest.preprocess?.rescale_factor??(1/255));
  const mean=manifest.preprocess?.image_mean||[.485,.456,.406],std=manifest.preprocess?.image_std||[.229,.224,.225];
  for(let y=0;y<th;y++){
    const y0=Math.floor(y*h/th),y1=Math.max(y0+1,Math.floor((y+1)*h/th));
    for(let x=0;x<tw;x++){
      const x0=Math.floor(x*w/tw),x1=Math.max(x0+1,Math.floor((x+1)*w/tw));
      // média de até 4×4 amostras da caixa (barato e sem aliasing forte)
      let r=0,g=0,b=0,c=0;const sy=Math.max(1,(y1-y0)>>2),sx=Math.max(1,(x1-x0)>>2);
      for(let yy=y0;yy<y1;yy+=sy)for(let xx=x0;xx<x1;xx+=sx){const p=(yy*w+xx)*4;r+=data[p];g+=data[p+1];b+=data[p+2];c++}
      const i=y*tw+x;
      out[i]=(r/c*f-mean[0])/std[0];out[n+i]=(g/c*f-mean[1])/std[1];out[2*n+i]=(b/c*f-mean[2])/std[2];
    }
  }
  return out;
}

// Executa o SegFormer e devolve o mapa de classes (argmax) na resolução de saída do modelo.
export async function runContextModel(loaded,img,{inputSide=512}={}){
  const{ort,session,manifest}=loaded;
  const scale=inputSide/Math.max(img.width,img.height);
  // múltiplos de 32 preservam o alinhamento dos estágios do SegFormer
  const tw=Math.max(64,Math.round(img.width*scale/32)*32),th=Math.max(64,Math.round(img.height*scale/32)*32);
  const tensor=new ort.Tensor("float32",tensorFromRgba(img,tw,th,manifest),[1,3,th,tw]);
  const inputName=manifest.inputs?.[0]?.name||session.inputNames?.[0]||"pixel_values";
  const outputs=await session.run({[inputName]:tensor});
  const outName=manifest.outputs?.[0]?.name||session.outputNames?.[0],out=outputs[outName]||outputs[Object.keys(outputs)[0]];
  if(!out?.data||out.dims?.length!==4)throw new Error("Saída inesperada do filtro de contexto.");
  const classes=Number(out.dims[1]),oh=Number(out.dims[2]),ow=Number(out.dims[3]),plane=oh*ow,d=out.data;
  const cls=new Uint8Array(plane),conf=new Float32Array(plane);
  for(let i=0;i<plane;i++){
    let best=0,max=-Infinity;for(let c=0;c<classes;c++){const v=d[c*plane+i];if(v>max){max=v;best=c}}
    let den=0;for(let c=0;c<classes;c++)den+=Math.exp(d[c*plane+i]-max);
    cls[i]=best;conf[i]=1/Math.max(den,1e-12);
  }
  return{cls,conf,w:ow,h:oh,input:[tw,th]};
}

// Máscara de exclusão (1 = região irrelevante) na resolução do mapa de classes.
export function exclusionFromClasses(map,labels,mode="conservative",minConfidence=.35){
  const{group,names}=contextGroups(labels),n=map.w*map.h,excl=new Uint8Array(n),struct=new Uint8Array(n);
  const counts=new Map();let excluded=0,structure=0;
  for(let i=0;i<n;i++){
    const c=map.cls[i],g=group[c]??0;
    counts.set(c,(counts.get(c)||0)+1);
    if(g===1){structure++;struct[i]=1}
    const drop=mode==="strict"?g!==1:g===2;
    if(drop&&map.conf[i]>=minConfidence){excl[i]=1;excluded++}
  }
  const top=[...counts.entries()].sort((a,b)=>b[1]-a[1]).slice(0,6).map(([c,k])=>({label:names[c]||String(c),group:["neutro","estrutura","irrelevante"][group[c]??0],share:+(k/n).toFixed(4)}));
  // Segurança: se quase tudo foi julgado irrelevante e quase nada é estrutura (ex.: close-up de
  // textura que o modelo não reconhece), o filtro se abstém em vez de apagar a inspeção.
  const uncertain=excluded/n>.9&&structure/n<.03;
  return{mask:excl,structure:struct,cls:map.cls,names,w:map.w,h:map.h,mode,excluded_ratio:+(excluded/n).toFixed(4),structure_ratio:+(structure/n).toFixed(4),top_classes:top,abstained:uncertain};
}

// Remove de uma máscara binária (w×h) os componentes 8-conexos cuja fração dentro da exclusão ≥ share.
export function gateMask(mask,w,h,excl,{share=DEFAULT_CONTEXT_SHARE}={}){
  if(!excl||excl.abstained)return{mask,removedMask:null,removed:0,kept:0,removed_px:0};
  const ex=excl.mask,ew=excl.w,eh=excl.h,out=new Uint8Array(mask),gone=new Uint8Array(w*h),seen=new Uint8Array(w*h),queue=new Int32Array(w*h);
  const mx=new Int32Array(w),my=new Int32Array(h);
  for(let x=0;x<w;x++)mx[x]=Math.min(ew-1,Math.floor((x+.5)*ew/w));
  for(let y=0;y<h;y++)my[y]=Math.min(eh-1,Math.floor((y+.5)*eh/h))*ew;
  let removed=0,kept=0,removedPx=0;
  for(let s=0;s<w*h;s++){
    if(!mask[s]||seen[s])continue;
    let head=0,tail=0,inside=0;queue[tail++]=s;seen[s]=1;
    while(head<tail){
      const p=queue[head++],y=(p/w)|0,x=p-y*w;
      if(ex[my[y]+mx[x]])inside++;
      for(let ny=y>0?y-1:0;ny<=(y<h-1?y+1:y);ny++)for(let nx=x>0?x-1:0;nx<=(x<w-1?x+1:x);nx++){
        const q=ny*w+nx;if(mask[q]&&!seen[q]){seen[q]=1;queue[tail++]=q}
      }
    }
    if(inside>=share*tail){for(let q=0;q<tail;q++){out[queue[q]]=0;gone[queue[q]]=1}removed++;removedPx+=tail}else kept++;
  }
  return{mask:out,removedMask:gone,removed,kept,removed_px:removedPx};
}

// Aplica o filtro a todas as camadas {classe: Uint8Array}; devolve novas máscaras e estatísticas.
export function gateMasks(masks,w,h,excl,opts={}){
  const out={},removed={},removedMasks={};let total=0;
  for(const[k,m]of Object.entries(masks||{})){
    if(!(m instanceof Uint8Array)||m.length!==w*h){out[k]=m;continue}
    const g=gateMask(m,w,h,excl,opts);out[k]=g.mask;removed[k]=g.removed;total+=g.removed;if(g.removedMask)removedMasks[k]=g.removedMask;
  }
  return{masks:out,removed,removedMasks,removed_total:total};
}

// Carrega o modelo (sessão em cache, SHA-256 verificado) e devolve a exclusão para uma ImageData.
export async function contextExclusion(getSession,img,mode,control={}){
  const loaded=await getSession(CONTEXT_ENGINE_ID,control);
  const map=await runContextModel(loaded,img,{inputSide:Number(control.inputSide||512)});
  const excl=exclusionFromClasses(map,loaded.manifest.labels,mode);
  return{...excl,model:loaded.manifest.source_repo||CONTEXT_ENGINE_ID,sha256:loaded.digest||loaded.manifest.sha256||null};
}

// Cena dominante sob os pixels de uma máscara dentro da caixa [x,y,w,h] (nomeia achados mantidos e descartados).
export function sceneOf(mask,w,h,bbox,excl){
  if(!excl?.cls||!excl.names)return null;
  const ew=excl.w,eh=excl.h,tally=new Map();let n=0,inEx=0;
  const x0=Math.max(0,Math.floor(bbox[0])),y0=Math.max(0,Math.floor(bbox[1])),x1=Math.min(w,Math.ceil(bbox[0]+bbox[2])),y1=Math.min(h,Math.ceil(bbox[1]+bbox[3]));
  for(let y=y0;y<y1;y++){const my=Math.min(eh-1,Math.floor((y+.5)*eh/h))*ew;for(let x=x0;x<x1;x++){
    if(!mask[y*w+x])continue;const q=my+Math.min(ew-1,Math.floor((x+.5)*ew/w)),c=excl.cls[q];
    tally.set(c,(tally.get(c)||0)+1);n++;if(excl.mask[q])inEx++;
  }}
  if(!n)return null;
  const[best,k]=[...tally.entries()].sort((a,b)=>b[1]-a[1])[0],label=excl.names[best]||String(best);
  return{label,label_pt:ptLabel(label),share:+(k/n).toFixed(3),irrelevant_share:+(inEx/n).toFixed(3)};
}
