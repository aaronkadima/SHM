import React,{useEffect,useMemo,useRef,useState}from"react";
import*as THREE from"three";
import{OrbitControls}from"three/addons/controls/OrbitControls.js";
import{Box,ChevronLeft,Crosshair,Download,FolderOpen,ImageDown,ImageIcon,Info,Mountain,Maximize2,Rotate3d,RotateCw,Save,Server,SquareDashedMousePointer,Trash2,FolderClock}from"lucide-react";
import{__cdm4Test,cdm4Config,cdm4StageData}from"./cdm4Core.js";
import{loadIfcThreeModel}from"./ifcGeometry.js";
import{worldTriangles,planarFace,faceToModel,imageFaceMapping,facePoint,faceUV,potentialAt}from"./ifcFace.js";
import{buildLevelSolid,buildRelief,buildCavity,layersAtPoint}from"./levelSolid.js";
import{cutHostGeometry,cavityWallsGeometry,cavityGhostGeometry,photoWithHoles}from"./cavityView.js";
import{rebarCenterlines,rebarTubes,nearestGauge,REBAR_GAUGES}from"./rebarCenterlines.js";
import{parseStep,lengthUnitMeters,writeLevelSolid,levelColor}from"./ifcLevelSolidWriter.js";
import{referenceHostIfc}from"./ifcReferenceHost.js";
import{saveLevelSolid,listLevelSolids,getLevelSolid,deleteLevelSolid}from"./levelSolidStore.js";
import{makeMetric,quadOk}from"./measureGeometry.js";
import{parseLevels}from"./CutLevelTool.jsx";
import{tr,getLang}from"./i18n.js";

// Sólido de níveis (CDM-4 → IFC): as curvas de nível do potencial do walker viram um sólido sobre uma face, como o
// bloco-diagrama de uma topografia — em camadas planas (terraços) ou em relevo contínuo, com vales. É a FORMA APROXIMADA
// do dano para achá-lo no modelo; a altura é proporcional ao potencial, não é profundidade medida.
// Modos: "standalone" (IFC novo com a superfície da foto), "ifc" (face clicada no modelo importado) e sólidos salvos.
// A janela fica dentro do canvas do Studio: barras superior e inferior continuam visíveis.
const SCHEMA_OK=s=>/^IFC4($|X3)/i.test(String(s||""));
const save=(name,blob)=>{const u=URL.createObjectURL(blob),a=document.createElement("a");a.href=u;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),4000)};
const LOCALE={pt:"pt-BR",en:"en-US",es:"es-ES",fr:"fr-FR"};
const loc=()=>LOCALE[String(getLang?.()||"pt").toLowerCase()]||"pt-BR";
const fmt=(v,d=2)=>Number(v).toLocaleString(loc(),{maximumFractionDigits:d,minimumFractionDigits:d});
const lv=t=>Number(t).toLocaleString(loc(),{maximumFractionDigits:3});
const pointIn=(p,r)=>{let ins=false;for(let i=0,j=r.length-1;i<r.length;j=i++){const[xi,yi]=r[i],[xj,yj]=r[j];if((yi>p[1])!==(yj>p[1])&&p[0]<(xj-xi)*(p[1]-yi)/(yj-yi)+xi)ins=!ins}return ins};
const keyOf=(r,t)=>`R${r}:${t}`;
const when=iso=>{try{return new Date(iso).toLocaleString(loc(),{day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"})}catch{return iso}};
// cor contínua do relevo: posição do potencial entre o primeiro e o último nível
const reliefColor=(u,levels)=>{const n=levels.length,t0=levels[0],t1=levels[n-1];const t=n>1?Math.max(0,Math.min(1,(u-t0)/Math.max(1e-6,t1-t0))):1;return levelColor(t*(n-1),n)};
const bandOf=(u,levels)=>{let b=0;for(let k=0;k<levels.length;k++)if(u>=levels[k])b=k;return b};
const mappingFrom=p=>p?imageFaceMapping({...p,metric:p.metricScale?makeMetric({kind:"homography",...p.metricScale}):null}):null;
async function shrinkPhoto(file,side=1024){const bmp=await createImageBitmap(file,{imageOrientation:"from-image"}),s=Math.min(1,side/Math.max(bmp.width,bmp.height)),c=document.createElement("canvas");c.width=Math.round(bmp.width*s);c.height=Math.round(bmp.height*s);c.getContext("2d").drawImage(bmp,0,0,c.width,c.height);bmp.close?.();return c}

export default function LevelSolidTool({active,onClose,result,file,options,serverEndpoint=null}){
  const host=useRef(null),three=useRef(null);
  const[mode,setMode]=useState(null),[ifc,setIfc]=useState(null),[loading,setLoading]=useState(0),[err,setErr]=useState(""),[busy,setBusy]=useState(""),[done,setDone]=useState("");
  const[pick,setPick]=useState(null),[pickingFace,setPickingFace]=useState(true),[rot,setRot]=useState(0),[mirror,setMirror]=useState(false);
  const[levels,setLevels]=useState("0,1; 0,3; 0,5; 0,7; 0,9"),[layerMm,setLayerMm]=useState(10),[minArea,setMinArea]=useState(4);
  const[style,setStyle]=useState("terraces"),[direction,setDirection]=useState(1),[detail,setDetail]=useState("medio");
  const[cutView,setCutView]=useState("hidden"),[cutIfc,setCutIfc]=useState(true),[cutState,setCutState]=useState(null);
  const[rebarOn,setRebarOn]=useState(false),[rebarDia,setRebarDia]=useState("auto"),[rebarPos,setRebarPos]=useState("floor"),[coverMm,setCoverMm]=useState(25),[rebarMask,setRebarMask]=useState(null);
  const[fit,setFit]=useState("contain"),[dx,setDx]=useState(0),[dy,setDy]=useState(0),[showPhoto,setShowPhoto]=useState(true);
  const[size,setSize]=useState("auto"),[widthMm,setWidthMm]=useState(1000),[schema,setSchema]=useState("IFC4X3");
  const[sel,setSel]=useState(null),[point,setPoint]=useState(null),[photo,setPhoto]=useState(null);
  const[library,setLibrary]=useState([]),[saved,setSaved]=useState(null),[saveName,setSaveName]=useState("");
  const W=result?.metrics?.processed_width||0,H=result?.metrics?.processed_height||0,[rwLive,setRw]=useState(null);
  const mmPerPx=Number(result?.metrics?.mm_per_px||options?.cdm_mm_per_px||0);

  // potencial do walker: o guardado no resultado ou, se não houver, recalculado com a mesma configuração (como no Corte de nível)
  useEffect(()=>{if(!active||!result||!file||!W)return;let live=true;
    (async()=>{try{let d=cdm4StageData(result);
      if(!d?.random_walker?.prob){const bmp=await createImageBitmap(file,{imageOrientation:"from-image"}),c=document.createElement("canvas");c.width=W;c.height=H;const ctx=c.getContext("2d",{willReadFrequently:true});ctx.drawImage(bmp,0,0,W,H);bmp.close?.();
        const cfg=cdm4Config({...(options||{}),cdm_context_filter:"off",cdm4_flow:result?.metrics?.protocol?.flow||options?.cdm4_flow});cfg.returnStages=true;d={...__cdm4Test.computeCdm4Core(ctx.getImageData(0,0,W,H),null,cfg).stages}}
      if(live){setRw(d?.random_walker?.prob?d.random_walker:false);const rm=d?.final?.exposed_rebar;setRebarMask(rm&&rm.length===W*H?{mask:rm,W,H}:null)}}catch(e){if(live){setRw(false);setErr(e?.message||String(e))}}})();
    return()=>{live=false}},[active,result,file,W,H]);
  // foto como textura (até 2048 px): a da análise ou a guardada no sólido salvo
  useEffect(()=>{if(!active)return;let live=true,tex=null;
    (async()=>{try{let c;if(saved?.photo){const bmp=await createImageBitmap(saved.photo);c=document.createElement("canvas");c.width=bmp.width;c.height=bmp.height;c.getContext("2d").drawImage(bmp,0,0);bmp.close?.()}else if(file)c=await shrinkPhoto(file,2048);else return;
      tex=new THREE.CanvasTexture(c);tex.colorSpace=THREE.SRGBColorSpace;if(live)setPhoto(tex)}catch{}})();
    return()=>{live=false;tex?.dispose()}},[active,file,saved]);
  const metric=useMemo(()=>{if(!file)return null;try{const v=JSON.parse(localStorage.getItem("shmScale:"+file.name+":"+file.size)||"null");
    return v?.quad?.length===4&&quadOk(v.quad)?{m:makeMetric({kind:"homography",quad:v.quad,wmm:+v.wmm,hmm:+v.hmm}),scale:{quad:v.quad,wmm:+v.wmm,hmm:+v.hmm},label:`${v.wmm} × ${v.hmm} mm`}:null}catch{return null}},[file,active]);
  const refreshLibrary=()=>listLevelSolids().then(setLibrary).catch(()=>setLibrary([]));
  useEffect(()=>{if(active)refreshLibrary()},[active]);
  useEffect(()=>{if(!active)return;const k=e=>{if(e.key!=="Escape"||/INPUT|SELECT/.test(e.target?.tagName||""))return;
    // com um menu da barra superior aberto (ou um painel de vistas/imagem), Esc fecha só ele
    if(document.querySelector(".editorMenu[open]"))return;if(viewMenuRef.current||shotMenuRef.current){e.stopPropagation();setViewMenu(false);setShotMenu(false);return}
    e.stopPropagation();onClose?.()};window.addEventListener("keydown",k,true);return()=>window.removeEventListener("keydown",k,true)},[active,onClose]);
  useEffect(()=>{if(!active){setMode(null);setIfc(null);setPick(null);setPoint(null);setSel(null);setErr("");setDone("");setSaved(null)}},[active]);
  const chooseMode=m=>{setMode(m);setSaved(null);setIfc(null);setPick(null);setPickingFace(true);setPoint(null);setSel(null);setErr("");setDone("")};

  // ---------- cena 3D (clara, como o visualizador 3D do Studio) ----------
  useEffect(()=>{
    if(!active||!mode||!host.current)return;const el=host.current;let renderer;
    try{renderer=new THREE.WebGLRenderer({antialias:true,alpha:true,preserveDrawingBuffer:true})}catch{setErr(tr("WebGL indisponível neste navegador."));return}
    renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));renderer.setClearColor(0x000000,0);renderer.domElement.className="lstCanvas";el.prepend(renderer.domElement);
    const scene=new THREE.Scene();
    const camera=new THREE.PerspectiveCamera(40,1,.01,5000);camera.position.set(3,2,4);
    const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.screenSpacePanning=true;
    scene.add(new THREE.HemisphereLight(0xffffff,0x8a9aa0,1.1));const sun=new THREE.DirectionalLight(0xffffff,1.5);sun.position.set(4,9,7);scene.add(sun);const fill=new THREE.DirectionalLight(0xffffff,.45);fill.position.set(-6,-2,5);scene.add(fill);
    const model=new THREE.Group(),solid=new THREE.Group(),mark=new THREE.Group(),pic=new THREE.Group(),cut=new THREE.Group();scene.add(model,cut,pic,solid,mark);
    const resize=()=>{const w=el.clientWidth||800,h=el.clientHeight||600;renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix()};resize();
    const ro=new ResizeObserver(resize);ro.observe(el);let raf=0;const loop=()=>{raf=requestAnimationFrame(loop);const A=three.current?.anim;
      // transição suave entre vistas (posição e alvo da câmera)
      if(A){const t=Math.min(1,(performance.now()-A.t0)/A.dur),e=t<.5?2*t*t:1-Math.pow(-2*t+2,2)/2;camera.position.lerpVectors(A.p0,A.p1,e);controls.target.lerpVectors(A.c0,A.c1,e);if(t>=1)three.current.anim=null}
      controls.update();renderer.render(scene,camera)};loop();
    const ray=new THREE.Raycaster();let down=null;
    const onDown=e=>{down=[e.clientX,e.clientY]};
    const onUp=e=>{if(!down||Math.hypot(e.clientX-down[0],e.clientY-down[1])>4)return;const r=renderer.domElement.getBoundingClientRect();
      ray.setFromCamera(new THREE.Vector2((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1),camera);
      three.current?.onPick?.(ray.intersectObjects([...solid.children,...pic.children,...cut.children,...model.children.filter(m=>m.visible)],false))};
    renderer.domElement.addEventListener("pointerdown",onDown);renderer.domElement.addEventListener("pointerup",onUp);
    three.current={scene,camera,controls,model,solid,mark,pic,cut,renderer};
    return()=>{cancelAnimationFrame(raf);ro.disconnect();controls.dispose();renderer.dispose();renderer.domElement.remove();three.current=null};
  },[active,mode]);
  const fitView=(obj,dir=[1,.55,1.3])=>{const T=three.current;obj=obj||T?.model;if(!T||!obj)return;const b=new THREE.Box3().setFromObject(obj);if(b.isEmpty())return;const c=b.getCenter(new THREE.Vector3()),r=b.getSize(new THREE.Vector3()).length()/2||1;
    T.controls.target.copy(c);T.camera.position.copy(c.clone().add(new THREE.Vector3(...dir).normalize().multiplyScalar(r*3)));T.camera.near=r/500;T.camera.far=r*100;T.camera.updateProjectionMatrix()};
  // ---------- vistas padrão e inclinadas (na moldura da face: n = para fora, ey = para cima, ex = direita) ----------
  const viewMenuRef=useRef(false),shotMenuRef=useRef(false);
  const[viewMenu,setViewMenu]=useState(false),[tilt,setTilt]=useState(35),[azim,setAzim]=useState(25),[shotMenu,setShotMenu]=useState(false),[shotLegend,setShotLegend]=useState(true),[activeView,setActiveView]=useState("");
  viewMenuRef.current=viewMenu;shotMenuRef.current=shotMenu;
  const viewTarget=()=>{const T=three.current;if(!T)return null;const obj=T.solid.children.length?T.solid:T.cut.children.length?T.cut:T.model;const b=new THREE.Box3().setFromObject(obj);
    if(b.isEmpty())return null;const c=b.getCenter(new THREE.Vector3()),r=Math.max(b.getSize(new THREE.Vector3()).length()/2,.05);return{c,r}};
  const dirFor=(name,tl=tilt,az=azim)=>{if(!face)return null;const n=new THREE.Vector3(...face.n),ey=new THREE.Vector3(...face.ey),ex=new THREE.Vector3(...face.ex);
    const tiltDir=(t,a)=>{const tr=t*Math.PI/180,ar=a*Math.PI/180,d=n.clone().multiplyScalar(Math.cos(tr)).add(ey.clone().multiplyScalar(Math.sin(tr)));return d.applyAxisAngle(n,ar).normalize()};
    switch(name){case"front":return n.clone().add(ey.clone().multiplyScalar(.002)).normalize();case"top":return ey.clone().add(n.clone().multiplyScalar(.02)).normalize();
      case"bottom":return ey.clone().negate().add(n.clone().multiplyScalar(.02)).normalize();case"left":return ex.clone().negate().add(n.clone().multiplyScalar(.02)).normalize();
      case"right":return ex.clone().add(n.clone().multiplyScalar(.02)).normalize();case"iso":return n.clone().add(ey.clone().multiplyScalar(.7)).add(ex.clone().multiplyScalar(.7)).normalize();
      case"graze":return tiltDir(72,az);default:return tiltDir(tl,az)}};
  const goView=(name,tl,az)=>{const T=three.current,tg=viewTarget(),d=dirFor(name,tl,az);if(!T||!tg||!d)return;
    const dist=tg.r/Math.tan(T.camera.fov*Math.PI/360)*1.15,p1=tg.c.clone().add(d.multiplyScalar(dist));
    T.anim={p0:T.camera.position.clone(),p1,c0:T.controls.target.clone(),c1:tg.c.clone(),t0:performance.now(),dur:450};T.camera.near=Math.max(1e-4,tg.r/400);T.camera.far=tg.r*400;T.camera.updateProjectionMatrix();setActiveView(name)};
  // imagem da vista atual em alta definição: só o objeto (recorte justo pelo alfa do renderizador, que tem fundo transparente),
  // sobre fundo branco, com a legenda numa coluna ao lado
  async function exportShot(scale){setErr("");try{const T=three.current;if(!T)return;const r=T.renderer,sz=r.getSize(new THREE.Vector2()),pr=r.getPixelRatio(),gl=r.getContext();
      const maxSide=Math.min(gl.getParameter(gl.MAX_RENDERBUFFER_SIZE)||8192,gl.getParameter(gl.MAX_TEXTURE_SIZE)||8192,8192),k=Math.max(1,Math.min(scale,maxSide/Math.max(sz.x,sz.y)));
      r.setPixelRatio(k);r.setSize(sz.x,sz.y,false);r.render(T.scene,T.camera);const src=r.domElement,W0=src.width,H0=src.height;
      const tmp=document.createElement("canvas");tmp.width=W0;tmp.height=H0;const tx=tmp.getContext("2d",{willReadFrequently:true});tx.drawImage(src,0,0);
      r.setPixelRatio(pr);r.setSize(sz.x,sz.y,false);
      // caixa do conteúdo (alfa > 8)
      const A=tx.getImageData(0,0,W0,H0).data;let x0=W0,y0=H0,x1=-1,y1=-1;
      for(let y=0;y<H0;y++){const row=y*W0*4;for(let xx=0;xx<W0;xx++)if(A[row+xx*4+3]>8){if(xx<x0)x0=xx;if(xx>x1)x1=xx;if(y<y0)y0=y;if(y>y1)y1=y}}
      if(x1<0){x0=0;y0=0;x1=W0-1;y1=H0-1}
      const m=Math.round(28*k);x0=Math.max(0,x0-m);y0=Math.max(0,y0-m);x1=Math.min(W0-1,x1+m);y1=Math.min(H0-1,y1+m);const cw=x1-x0+1,ch=y1-y0+1;
      // legenda lateral
      const f=v=>`${Math.round(v*k)}px Inter, system-ui, sans-serif`,lw=shotLegend?Math.round(270*k):0,pad=Math.round(20*k),inner=lw-2*pad;
      const lev=built?.levels||[],rebars=curDir<0?(cavity?.regions||[]).flatMap(rg=>rg.rebars||[]):[],mx=document.createElement("canvas").getContext("2d");
      const wrap=(text,font,width)=>{mx.font=font;const out=[];let line="";for(const w of String(text).split(" ")){const t=line?line+" "+w:w;if(mx.measureText(t).width>width&&line){out.push(line);line=w}else line=t}if(line)out.push(line);return out};
      const blocks=[];const push=(text,font,color,gap=6)=>{for(const l of wrap(text,font,inner))blocks.push({t:l,font,color,h:Math.round(parseFloat(font.match(/(\d+)px/)[1])*1.45)});blocks.at(-1).gap=gap*k};
      if(shotLegend){
        push(`${tr("Sólido de níveis")} · CDM-4`,"650 "+f(15),"#1f3540",4);
        push(`${curDir<0?tr("Côncava (cavidade)"):tr("Convexa (para fora)")} · ${curStyle==="relief"?tr("relevo com vales"):tr("camadas planas")}`,f(11.5),"#4d6570",14);
        push(tr("Níveis do walker").toUpperCase(),"650 "+f(9.5),"#6f8590",6);
        lev.forEach((t,i)=>blocks.push({chip:levelColor(i,lev.length),t:`u ≥ ${lv(t)}`,sub:curStyle==="relief"?"":`${fmt((i+1)*(built?.layerMm||0),0)} mm`,font:f(11.5),color:"#263e4b",h:Math.round(20*k)}));
        blocks.at(-1).gap=12*k;
        if(rebars.length){const ds=[...new Set(rebars.map(b=>b.d))].sort((a,b)=>a-b).map(lv).join("; ");blocks.push({chip:[.48,.37,.3],t:`${tr("Armadura")} · Ø ${ds} mm`,font:f(11.5),color:"#263e4b",h:Math.round(20*k),gap:12*k})}
        const info=[face?.name,(saved?.image?.name||file?.name||""),new Date(saved?.created_at||Date.now()).toLocaleDateString(loc())].filter(Boolean).join(" · ");
        push(info,f(10.5),"#6f8590",10);
        push(tr("Forma aproximada do dano para identificação visual no modelo. A altura de cada camada é o nível do potencial × a espessura escolhida; não é profundidade medida."),f(10),"#8a6a12",0);
      }
      const lh=blocks.reduce((acc,b2)=>acc+b2.h+(b2.gap||0),0)+2*pad,W=cw+lw,H=Math.max(ch,lh);
      const c=document.createElement("canvas");c.width=W;c.height=H;const x=c.getContext("2d");
      x.fillStyle="#fff";x.fillRect(0,0,W,H);x.drawImage(tmp,x0,y0,cw,ch,0,Math.round((H-ch)/2),cw,ch);
      if(lw){x.fillStyle="#f6f9fa";x.fillRect(cw,0,lw,H);x.fillStyle="#dce5e8";x.fillRect(cw,0,Math.max(1,Math.round(k)),H);
        let y=Math.max(pad,Math.round((H-lh)/2)+pad);x.textBaseline="middle";
        for(const b2 of blocks){const cy=y+b2.h/2;let lx=cw+pad;
          if(b2.chip){const col=b2.chip.map(v=>Math.round(v*255));x.fillStyle=`rgb(${col})`;x.fillRect(lx,cy-6*k,12*k,12*k);lx+=20*k}
          x.font=b2.font;x.fillStyle=b2.color;x.fillText(b2.t,lx,cy);
          if(b2.sub){x.fillStyle="#6f8590";x.textAlign="right";x.fillText(b2.sub,cw+lw-pad,cy);x.textAlign="left"}
          y+=b2.h+(b2.gap||0)}}
      const blob=await new Promise(res=>c.toBlob(res,"image/png")),base=(saved?.image?.name||file?.name||"foto").replace(/\.[^.]+$/,"");
      save(`${base}_solido_vista_${c.width}x${c.height}.png`,blob);setDone(`${tr("Imagem da vista")}: ${c.width} × ${c.height} px`);setShotMenu(false)}catch(e){setErr(e?.message||String(e))}}
  async function loadIfcIntoScene(f){const group=await loadIfcThreeModel(f,{onProgress:p=>setLoading(Math.max(1,p.loaded))}),T=three.current;
    if(T){T.model.clear();while(group.children.length)T.model.add(group.children[0]);T.model.updateMatrixWorld(true);fitView(T.model)}return group}

  async function openIfc(f){
    setErr("");setDone("");setPick(null);setPoint(null);setSel(null);setPickingFace(true);if(!f)return;
    try{
      setLoading(1);const text=await f.text(),M=parseStep(text);
      if(!SCHEMA_OK(M.schema))throw new Error(tr("Esquema não suportado")+`: ${M.schema||"?"} — ${tr("use IFC4 ou IFC 4.3")}`);
      const group=await loadIfcIntoScene(f);
      setIfc({name:f.name,text,schema:M.schema,unitM:lengthUnitMeters(M),coordination:group.userData.ifc?.coordination||null,elements:group.userData.ifc?.elementCount||0});
    }catch(e){setErr(e?.message||String(e))}finally{setLoading(0)}
  }
  async function openSaved(id){
    setErr("");setDone("");setPoint(null);setSel(null);
    try{const rec=await getLevelSolid(id);if(!rec)throw new Error(tr("Sólido salvo não encontrado."));
      setSaved(rec);setMode(rec.mode);setIfc(null);setPick(null);setPickingFace(false);setSchema(rec.schema&&/X3/i.test(rec.schema)?"IFC4X3":rec.schema?"IFC4":"IFC4X3");setShowPhoto(true);
    }catch(e){setErr(e?.message||String(e))}}
  async function removeSaved(id){try{await deleteLevelSolid(id);if(saved?.id===id){setSaved(null);setMode(null)}refreshLibrary()}catch(e){setErr(e?.message||String(e))}}
  // modelo do sólido salvo: o IFC guardado (a placa do modo sem importação é refeita abaixo)
  useEffect(()=>{if(!saved||!mode)return;let live=true;
    (async()=>{try{if(saved.mode==="ifc"&&saved.ifc?.blob){setLoading(1);const g=await loadIfcIntoScene(new File([saved.ifc.blob],saved.ifc.name));if(live)setIfc({...saved.ifc,coordination:g.userData.ifc?.coordination||saved.ifc.coordination,elements:g.userData.ifc?.elementCount||0})}}
      catch(e){if(live)setErr(e?.message||String(e))}finally{if(live)setLoading(0)}})();
    return()=>{live=false}},[saved,mode]);

  // ---------- superfície no modo sem importação ----------
  const plate=useMemo(()=>{
    if(saved)return saved.plate||null;
    if(mode!=="standalone"||!W)return null;
    const kind=size==="auto"?(metric?"metric":mmPerPx>0?"mmpx":"width"):size;
    if(kind==="metric"&&metric){const pts=[];for(let i=0;i<=20;i++){const t=i/20;pts.push(metric.m.map(t*W,0),metric.m.map(t*W,H),metric.m.map(0,t*H),metric.m.map(W,t*H))}
      const u0=Math.min(...pts.map(p=>p[0])),v0=Math.min(...pts.map(p=>p[1])),u1=Math.max(...pts.map(p=>p[0])),v1=Math.max(...pts.map(p=>p[1]));
      return{kind,wmm:u1-u0,hmm:v1-v0,map:{fit:"metric",metricScale:metric.scale,dx:-u0,dy:-v0},label:tr("escala da foto")+` (${metric.label})`}}
    const usePx=kind==="mmpx"&&mmPerPx>0,k=usePx?mmPerPx:Math.max(1,+widthMm||1000)/W;
    return{kind:usePx?"mmpx":"width",wmm:W*k,hmm:H*k,map:{fit:"scale",k},label:usePx?`${fmt(mmPerPx,3)} mm/px`:tr("largura informada")+` ${fmt(W*k,0)} mm`};
  },[saved,mode,W,H,size,metric,mmPerPx,widthMm]);
  const face=useMemo(()=>{
    if(saved)return saved.face;
    if(mode==="standalone"&&plate){const w=plate.wmm/1000,h=plate.hmm/1000;return{origin:[0,h,0],ex:[1,0,0],ey:[0,1,0],n:[0,0,1],width:w,height:h,triangles:[],name:tr("Superfície de referência (foto)")}}
    if(mode==="ifc"&&pick){const F=planarFace(pick.tris,pick.tri,{rot});return F&&{...F,name:pick.info.name||pick.info.type||"IFC"}}
    return null;
  },[saved,mode,plate,pick,rot]);
  const mapParams=useMemo(()=>{if(saved)return saved.map;if(!face||!W)return null;
    if(mode==="standalone")return{W,H,faceWmm:plate.wmm,faceHmm:plate.hmm,...plate.map};
    const useM=fit==="metric"&&metric;return{W,H,faceWmm:face.width*1000,faceHmm:face.height*1000,fit:useM?"metric":"contain",metricScale:useM?metric.scale:null,dx:+dx||0,dy:+dy||0,mirror}},[saved,face,mode,plate,W,H,fit,metric,dx,dy,mirror]);
  const mapping=useMemo(()=>mappingFrom(mapParams),[mapParams]);
  const rw=saved?saved.rw:rwLive;
  const fGrid=rw?(rw.f||Math.max(1,Math.round((mapParams?.W||W)/rw.W))):1;
  const builtLive=useMemo(()=>{
    if(saved||!mapping||!rw?.prob)return null;const ls=parseLevels(levels);if(!ls.length)return{error:tr("Informe ao menos um nível entre 0 e 1.")};
    return buildLevelSolid({prob:rw.prob,W:rw.W,H:rw.H,f:fGrid},mapping.toPlane,{levels:ls,layerMm:Math.max(.1,+layerMm||10),minAreaMm2:Math.max(0,+minArea||0)*1e4});
  },[saved,mapping,rw,fGrid,levels,layerMm,minArea]);
  const built=saved?saved.solid:builtLive;
  const curStyle=saved?saved.params.style:style,curDir=saved?saved.params.direction:direction;
  const reliefLive=useMemo(()=>{if(saved||curStyle!=="relief"||!builtLive?.regions?.length||!mapping||!rw?.prob)return null;
    return buildRelief({prob:rw.prob,W:rw.W,H:rw.H,f:fGrid},mapping.toPlane,builtLive,{detail})},[saved,curStyle,builtLive,mapping,rw,fGrid,detail]);
  const relief=saved?saved.relief:reliefLive;
  // côncava: cavidade = fundo colorido + recorte em degraus (o mesmo volume gravado no IFC como IfcVoidingFeature)
  const cavityLive=useMemo(()=>{if(saved||curDir>=0||!builtLive?.regions?.length||!mapping||!rw?.prob)return null;
    return buildCavity({prob:rw.prob,W:rw.W,H:rw.H,f:fGrid},mapping.toPlane,builtLive,{style:curStyle==="relief"?"relief":"terraces",detail})},[saved,curDir,curStyle,builtLive,mapping,rw,fGrid,detail]);
  // armadura exposta projetada na cavidade: eixos da máscara exposed_rebar → tubos no plano da face, com diâmetro nominal
  // (NBR 7480) estimado pela largura detectada ou informado, apoiados no fundo da cavidade ou a um cobrimento dado
  const rebarLines=useMemo(()=>{if(saved||!rebarMask)return null;try{return rebarCenterlines(rebarMask.mask,rebarMask.W,rebarMask.H)}catch{return null}},[saved,rebarMask]);
  const rebarLive=useMemo(()=>{
    if(saved||curDir>=0||!rebarOn||!rebarLines?.length||!cavityLive||!mapping||!rw?.prob||!builtLive?.levels)return null;
    const lev=builtLive.levels,t0=lev[0],Hh=lev.length*builtLive.layerMm,relief=curStyle==="relief";
    const floorAt=(x,y)=>{const u=potentialAt(rw,fGrid,x,y);if(u==null||u<t0)return 0;if(relief)return Hh*(u-t0)/(1-t0);let k=0;for(const t of lev)if(u>=t)k++;return k*builtLive.layerMm};
    const scaleAt=(x,y)=>{const a=mapping.toPlane(x,y),b=mapping.toPlane(x+1,y),c=mapping.toPlane(x,y+1);return(Math.hypot(b[0]-a[0],b[1]-a[1])+Math.hypot(c[0]-a[0],c[1]-a[1]))/2};
    const bars=[];for(const L of rebarLines){
      const mid=L.pts[L.pts.length>>1],dEst=2*L.r*scaleAt(...mid),d=rebarDia==="auto"?nearestGauge(dEst):+rebarDia;
      // densifica a cada ~2 px para a profundidade acompanhar o fundo
      const dense=[];for(let k=0;k+1<L.pts.length;k++){const[a,b]=[L.pts[k],L.pts[k+1]],n=Math.max(1,Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/2));for(let i=0;i<n;i++)dense.push([a[0]+(b[0]-a[0])*i/n,a[1]+(b[1]-a[1])*i/n])}dense.push(L.pts.at(-1));
      const pts=dense.map(([x,y])=>{const[u,v]=mapping.toPlane(x,y),axis=rebarPos==="cover"?(+coverMm||0)+d/2:Math.max(d/2+1,floorAt(x,y)-.15*d);return[u,v,axis]});
      // suaviza a profundidade (média móvel) para o tubo não serrilhar sobre o relevo
      const sm=pts.map((p,i)=>{let s2=0,n2=0;for(let j=Math.max(0,i-4);j<=Math.min(pts.length-1,i+4);j++){s2+=pts[j][2];n2++}return[p[0],p[1],s2/n2]});
      bars.push({pts:sm,d,dEst,len:L.len})}
    return bars},[saved,curDir,rebarOn,rebarLines,cavityLive,mapping,rw,fGrid,builtLive,curStyle,rebarDia,rebarPos,coverMm]);
  // cada barra vai para a região da cavidade que contém o seu ponto médio
  const cavityWithRebar=useMemo(()=>{if(!cavityLive)return null;if(!rebarLive?.length)return cavityLive;
    const regs=cavityLive.regions.map(r=>({...r,rebars:[]}));
    for(const b of rebarLive){const m=b.pts[b.pts.length>>1];let k=regs.findIndex(r=>r.steps.some(st=>st.polys.some(p=>pointIn(m,p.outer))));if(k<0)k=0;const t=rebarTubes([b]);regs[k].rebars.push({...t,d:b.d,dEst:b.dEst,len:b.len})}
    return{...cavityLive,regions:regs,rebar:{count:rebarLive.length,mode:rebarPos,coverMm:+coverMm,diameter:rebarDia}}},[cavityLive,rebarLive,rebarPos,coverMm,rebarDia]);
  const cavity=saved?saved.cavity||null:cavityWithRebar;
  const curCutView=saved?saved.params.cutView||"hidden":cutView,curCutIfc=saved?saved.params.cutIfc!==false:cutIfc;
  const hostGuid=saved?saved.hostGuid:pick?.info?.globalId;
  useEffect(()=>{setPoint(null);setSel(null)},[built,relief,cavity]);

  // placa de referência (sem importação): sempre mais espessa que a cavidade mais funda, para o recorte não atravessá-la
  const plateT=Math.max(100,(built?.levels?.length||5)*(built?.layerMm||10)+50);
  useEffect(()=>{const T=three.current;if(!T||mode!=="standalone"||!plate)return;T.model.clear();
    const w=plate.wmm/1000,h=plate.hmm/1000,t=plateT/1000,m=new THREE.Mesh(new THREE.BoxGeometry(w,h,t),new THREE.MeshStandardMaterial({color:0xc9cfd1,roughness:.9,transparent:true}));
    m.position.set(w/2,h/2,-t/2);m.userData.plate=true;T.model.add(m);fitView(T.model,[.55,.35,1])},[mode,plate,plateT]);
  // para dentro: o elemento fica translúcido para o sólido aparecer
  useEffect(()=>{const T=three.current;if(!T)return;T.model.traverse(n=>{if(!n.isMesh)return;const mats=Array.isArray(n.material)?n.material:[n.material];
    for(const m of mats){if(m.userData.op==null)m.userData.op=m.opacity;m.transparent=true;const glass=curDir<0&&cutState!=="ok";m.opacity=glass?Math.min(.35,m.userData.op):m.userData.op;m.depthWrite=!glass;m.needsUpdate=true}})},[curDir,cutState,ifc,plate,mode]);
  // recorte na vista: a face do hospedeiro é refeita com a boca da cavidade como furo; paredes e pisos dos degraus com o
  // material do elemento; no modo transparente, o volume removido aparece como uma película translúcida
  useEffect(()=>{const T=three.current;if(!T)return;T.cut.clear();T.model.children.forEach(m=>{if(m.userData.cutHidden){m.visible=true;m.userData.cutHidden=false}});
    if(curDir>=0||!cavity?.regions?.length||!face){setCutState(null);return}
    const hosts=T.model.children.filter(m=>m.isMesh&&(mode==="standalone"?m.userData.plate:hostGuid&&m.userData.ifc?.globalId===hostGuid));
    if(!hosts.length){setCutState(null);return}
    let ok=false,outside=false,color=new THREE.Color(0xb9c1c4);
    for(const m of hosts){m.updateMatrixWorld(true);const g=m.geometry,tris=worldTriangles(g.attributes.position.array,g.index?.array||null,m.matrixWorld.elements,g.attributes.normal?.array||null);
      const n=face.n,d0=n[0]*face.origin[0]+n[1]*face.origin[1]+n[2]*face.origin[2];
      const ft=tris.filter(t=>t.area&&t.n[0]*n[0]+t.n[1]*n[1]+t.n[2]*n[2]>.999&&t.P.every(p=>Math.abs(p[0]*n[0]+p[1]*n[1]+p[2]*n[2]-d0)<.002));if(!ft.length)continue;
      const cg=cutHostGeometry(face,tris,ft,cavity);if(!cg){outside=true;continue}
      const mat=(Array.isArray(m.material)?m.material[0]:m.material).clone();mat.transparent=false;mat.opacity=1;mat.depthWrite=true;mat.side=THREE.DoubleSide;color=mat.color?.clone?.()||color;
      const cm=new THREE.Mesh(cg,mat);cm.userData.cutHost=true;cm.userData.ifc=m.userData.ifc;T.cut.add(cm);m.visible=false;m.userData.cutHidden=true;ok=true}
    if(ok){const wall=new THREE.Mesh(cavityWallsGeometry(face,cavity),new THREE.MeshStandardMaterial({color:color.clone().multiplyScalar(.82),roughness:.95,side:THREE.DoubleSide}));wall.userData.cutWall=true;T.cut.add(wall);
      if(curCutView==="transparent")for(const g of cavityGhostGeometry(face,cavity))T.cut.add(new THREE.Mesh(g,new THREE.MeshStandardMaterial({color,transparent:true,opacity:.28,depthWrite:false,side:THREE.DoubleSide})))}
    setCutState(ok?"ok":outside?"outside":null);
  },[curDir,cavity,face,mode,hostGuid,ifc,plate,curCutView]);
  // foto projetada na face (em grade: vale também para a homografia)
  useEffect(()=>{const T=three.current;if(!T)return;T.pic.clear();if(!face||!mapping||!photo||!showPhoto||!mapParams)return;
    if(curDir<0&&cutState==="ok"&&cavity){const m=new THREE.Mesh(photoWithHoles(face,mapping,mapParams.W,mapParams.H,cavity,.3),new THREE.MeshBasicMaterial({map:photo,side:THREE.DoubleSide,transparent:true,opacity:.95,depthWrite:false}));
      m.userData.photo=true;T.pic.add(m);return}
    const N=24,pos=[],uv=[],idx=[],Wm=mapParams.W,Hm=mapParams.H;for(let j=0;j<=N;j++)for(let i=0;i<=N;i++){const[u,v]=mapping.toPlane(i/N*Wm,j/N*Hm);pos.push(...facePoint(face,u,v,.3*(curDir<0?-1:1)));uv.push(i/N,1-j/N)}
    for(let j=0;j<N;j++)for(let i=0;i<N;i++){const a=j*(N+1)+i,b=a+1,c=a+N+1,d=c+1;idx.push(a,c,b,b,c,d)}
    const g=new THREE.BufferGeometry();g.setAttribute("position",new THREE.Float32BufferAttribute(pos,3));g.setAttribute("uv",new THREE.Float32BufferAttribute(uv,2));g.setIndex(idx);
    const m=new THREE.Mesh(g,new THREE.MeshBasicMaterial({map:photo,side:THREE.DoubleSide,transparent:true,opacity:curDir<0?.28:.92,depthWrite:false}));m.userData.photo=true;T.pic.add(m)},[face,mapping,mapParams,photo,showPhoto,curDir,cutState,cavity]);
  // face destacada + sólido (camadas planas ou relevo) na moldura da face
  useEffect(()=>{const T=three.current;if(!T)return;T.mark.clear();T.solid.clear();if(!face)return;
    if(face.triangles?.length&&!(photo&&showPhoto)){const pos=new Float32Array(face.triangles.flatMap(t=>t.P.flatMap(p=>[p[0]+face.n[0]*.0004,p[1]+face.n[1]*.0004,p[2]+face.n[2]*.0004]))),g=new THREE.BufferGeometry();
      g.setAttribute("position",new THREE.BufferAttribute(pos,3));T.mark.add(new THREE.Mesh(g,new THREE.MeshBasicMaterial({color:0x0d766e,transparent:true,opacity:.22,side:THREE.DoubleSide,depthWrite:false})))}
    if(!built?.regions)return;
    const d=curDir<0?-1:1,basis=new THREE.Matrix4().makeBasis(new THREE.Vector3(...face.ex),new THREE.Vector3(...face.ey),new THREE.Vector3(...face.n)).setPosition(...face.origin);
    if(d<0&&cavity?.regions){
      // côncava: só o fundo da cavidade, colorido (relevo: cor contínua; degraus: cor da faixa)
      for(const R of cavity.regions){const L=R.lining,n=L.positions.length/3,pos=new Float32Array(n*3),col=new Float32Array(n*3);
        for(let v=0;v<n;v++){pos[v*3]=L.positions[v*3]/1000;pos[v*3+1]=-L.positions[v*3+1]/1000;pos[v*3+2]=-L.positions[v*3+2]/1000;
          col.set(curStyle==="relief"?reliefColor(L.u[v],built.levels):levelColor(bandOf(L.u[v],built.levels),built.levels.length),v*3)}
        const g=new THREE.BufferGeometry();g.setAttribute("position",new THREE.BufferAttribute(pos,3));g.setAttribute("color",new THREE.BufferAttribute(col,3));g.setIndex(new THREE.BufferAttribute(L.indices,1));g.computeVertexNormals();
        const mesh=new THREE.Mesh(g,new THREE.MeshStandardMaterial({vertexColors:true,roughness:.75,side:THREE.DoubleSide,transparent:true}));mesh.matrixAutoUpdate=false;mesh.matrix.copy(basis);mesh.userData.layer={region:R.id,relief:true,u:L.u,base:col.slice()};T.solid.add(mesh)
        // armadura exposta (aço com oxidação), mesma moldura da face
        for(const rb of R.rebars||[]){const n2=rb.positions.length/3,pp=new Float32Array(n2*3);for(let v=0;v<n2;v++){pp[v*3]=rb.positions[v*3]/1000;pp[v*3+1]=-rb.positions[v*3+1]/1000;pp[v*3+2]=-rb.positions[v*3+2]/1000}
          const gg=new THREE.BufferGeometry();gg.setAttribute("position",new THREE.BufferAttribute(pp,3));gg.setIndex(new THREE.BufferAttribute(rb.indices,1));gg.computeVertexNormals();
          const bm=new THREE.Mesh(gg,new THREE.MeshStandardMaterial({color:0x7a5f4c,metalness:.55,roughness:.42,side:THREE.DoubleSide}));bm.matrixAutoUpdate=false;bm.matrix.copy(basis);bm.userData.rebar={d:rb.d,dEst:rb.dEst,len:rb.len};T.solid.add(bm)}}
      return}
    if(curStyle==="relief"&&relief?.regions){
      for(const R of relief.regions){const n=R.positions.length/3,pos=new Float32Array(n*3),col=new Float32Array(n*3);
        for(let v=0;v<n;v++){pos[v*3]=R.positions[v*3]/1000;pos[v*3+1]=-R.positions[v*3+1]/1000;pos[v*3+2]=d*(R.positions[v*3+2]+.5)/1000;col.set(reliefColor(R.u[v],built.levels),v*3)}
        const g=new THREE.BufferGeometry();g.setAttribute("position",new THREE.BufferAttribute(pos,3));g.setAttribute("color",new THREE.BufferAttribute(col,3));g.setIndex(new THREE.BufferAttribute(R.indices,1));g.computeVertexNormals();
        const mesh=new THREE.Mesh(g,new THREE.MeshStandardMaterial({vertexColors:true,roughness:.65,side:THREE.DoubleSide,transparent:true}));mesh.matrixAutoUpdate=false;mesh.matrix.copy(basis);mesh.userData.layer={region:R.id,relief:true,u:R.u,base:col.slice()};T.solid.add(mesh)}
      return}
    for(const R of built.regions)for(const L of R.layers){const k=built.levels.indexOf(L.level),[r,g,b]=levelColor(k,built.levels.length);
      for(const p of L.polys){const sh=new THREE.Shape(p.outer.map(([u,v])=>new THREE.Vector2(u/1000,-v/1000)));sh.holes=p.holes.map(h=>new THREE.Path(h.map(([u,v])=>new THREE.Vector2(u/1000,-v/1000))));
        const geo=new THREE.ExtrudeGeometry(sh,{depth:(L.z1-L.z0)/1000,bevelEnabled:false,curveSegments:1});geo.translate(0,0,(d>0?L.z0+.5:-(L.z1+.5))/1000);
        const mesh=new THREE.Mesh(geo,new THREE.MeshStandardMaterial({color:new THREE.Color(r,g,b),roughness:.7,side:THREE.DoubleSide,transparent:true}));mesh.matrixAutoUpdate=false;mesh.matrix.copy(basis);mesh.userData.layer={key:keyOf(R.id,L.level),region:R.id,level:L.level};T.solid.add(mesh)}}
  },[face,built,relief,cavity,curStyle,curDir,photo,showPhoto]);
  // destaque da camada selecionada (no relevo: a faixa de potencial da camada) e marcador do ponto
  useEffect(()=>{const T=three.current;if(!T)return;const[sr,st]=sel?sel.slice(1).split(":").map(Number):[null,null];
    T.solid.children.forEach(m=>{const L=m.userData.layer;if(!L)return;
      if(L.relief){const c=m.geometry.attributes.color,lev=built?.levels||[];for(let v=0;v<L.u.length;v++){const on=!sel||(L.region===sr&&lev[bandOf(L.u[v],lev)]===st&&L.u[v]>=lev[0]);
          if(on)c.setXYZ(v,L.base[v*3],L.base[v*3+1],L.base[v*3+2]);else c.setXYZ(v,.80+.1*L.base[v*3],.82+.1*L.base[v*3+1],.83+.1*L.base[v*3+2])}c.needsUpdate=true;return}
      const on=!sel||L.key===sel;m.material.opacity=on?1:.16;m.material.depthWrite=on;m.material.emissive?.setHex(sel&&on?0x1d3c40:0);m.material.needsUpdate=true});
    T.mark.children.filter(c=>c.userData.point).forEach(c=>T.mark.remove(c));
    if(point&&face){const d=curDir<0?-1:1,top=point.layers.at(-1),lev=built?.levels||[],H0=lev.length*(built?.layerMm||0),
        hR=point.pot!=null&&lev.length?Math.max(0,H0*(point.pot-lev[0])/(1-lev[0])):0,h=curDir<0?(curStyle==="relief"?hR:(top?top.z1:0))+.3:curStyle==="relief"?hR+.5:(top?top.z1+.5:1),
        p=facePoint(face,point.u,point.v,d*h),s=new THREE.Mesh(new THREE.SphereGeometry(Math.max(face.width,face.height)/160,16,12),new THREE.MeshBasicMaterial({color:0xc2413b}));s.position.set(...p);s.userData.point=true;T.mark.add(s)}
  },[sel,point,face,built,relief,curStyle,curDir]);

  // clique: face (modo IFC, antes de escolher) → ponto (no sólido, na face, na foto ou na placa)
  const pickPoint=p=>{if(!face||!built?.regions||!mapping)return;const[u,v]=faceUV(face,p),[x,y]=mapping.toImage(u,v),pot=rw?.prob?potentialAt(rw,fGrid,x,y):null,layers=layersAtPoint(built,u,v);
    setPoint({u,v,pot,layers});const top=layers.at(-1);setSel(top?keyOf(top.region,top.level):null)};
  if(three.current)three.current.onPick=hits=>{
    if(!hits.length)return;
    if(mode==="ifc"&&!saved&&(pickingFace||!face)){const h=hits.find(x=>x.object.userData?.ifc?.globalId);if(!h)return;const m=h.object,g=m.geometry;m.updateMatrixWorld(true);
      setPick({tris:worldTriangles(g.attributes.position.array,g.index?.array||null,m.matrixWorld.elements,g.attributes.normal?.array||null),tri:h.faceIndex,info:m.userData.ifc});setPickingFace(false);setDone("");return}
    const h=hits[0];if(!face)return;
    if(h.object.userData?.rebar){pickPoint(h.point.toArray());setPoint(p=>p&&{...p,rebar:h.object.userData.rebar});return}
    if(h.object.userData?.layer||h.object.userData?.photo||h.object.userData?.plate){pickPoint(h.point.toArray());return}
    const p=h.point.toArray(),dd=face.n[0]*(p[0]-face.origin[0])+face.n[1]*(p[1]-face.origin[1])+face.n[2]*(p[2]-face.origin[2]);if(Math.abs(dd)<.06)pickPoint(p)};

  // ---------- exportação ----------
  const exportJob=async()=>{
    const src=saved||null,imgName=src?.image?.name||file?.name||"foto",base=imgName.replace(/\.[^.]+$/,"");
    const meta={className:tr("Desplacamento"),image:imgName,date:(src?.created_at||new Date().toISOString()).slice(0,10)};
    const extra={relief:curStyle==="relief"&&curDir>=0?relief:null,direction:curDir,cavity:curDir<0?cavity:null,voids:curCutIfc};
    if(mode==="standalone"){const h=referenceHostIfc({schema,widthMm:plate.wmm,heightMm:plate.hmm,thicknessMm:plateT,description:`${imgName} · ${plate.label}`,fileName:base+"_CDM4.ifc"});
      return{text:h.text,name:`${base}_CDM4_forma_dano_${h.schema}.ifc`,payload:{host_guid:h.hostGuid,face:h.face,solid:built,meta:{...meta,scale:plate.label},...extra}}}
    if(src)return{text:await src.ifc.blob.text(),name:src.ifc.name.replace(/\.ifc$/i,"")+"_CDM4_forma_dano.ifc",payload:{host_guid:src.hostGuid,face:src.faceModel,solid:built,meta:{...meta,scale:src.scaleLabel||""},...extra}};
    return{text:ifc.text,name:ifc.name.replace(/\.ifc$/i,"")+"_CDM4_forma_dano.ifc",payload:{host_guid:pick.info.globalId,face:faceToModel(face,ifc.coordination,ifc.unitM),solid:built,meta:{...meta,scale:fit==="metric"&&metric?metric.label:tr("imagem encaixada na face")},...extra}};
  };
  const jsonCavity=c=>c?{...c,regions:c.regions.map(x=>({id:x.id,lining:{positions:Array.from(x.lining.positions),indices:Array.from(x.lining.indices),band:Array.from(x.lining.band)},steps:x.steps,rebars:(x.rebars||[]).map(b=>({positions:Array.from(b.positions),indices:Array.from(b.indices),d:b.d,dEst:b.dEst}))}))}:null;
  const jsonRelief=r=>r?{...r,regions:r.regions.map(x=>({id:x.id,positions:Array.from(x.positions),indices:Array.from(x.indices),band:Array.from(x.band)}))}:null;
  async function exportBrowser(){setErr("");try{const j=await exportJob(),p=j.payload,r=writeLevelSolid(j.text,{hostGuid:p.host_guid,face:p.face,solid:p.solid,meta:p.meta,relief:p.relief,direction:p.direction,cavity:p.cavity,voids:p.voids});
    save(j.name,new Blob([r.text],{type:"application/x-step"}));setDone(`${tr("Arquivo gerado")}: ${r.schema} · ${r.features.length} ${tr("características")}${r.voids?` · ${r.voids} ${tr("recortes")}`:""} · ${r.relation}`)}catch(e){setErr(e?.message||String(e))}}
  async function exportServer(){setErr("");setBusy("server");try{const j=await exportJob(),base=serverEndpoint(),fd=new FormData();fd.append("ifc",new Blob([j.text],{type:"application/x-step"}),j.name);fd.append("payload_json",JSON.stringify({...j.payload,relief:jsonRelief(j.payload.relief),cavity:jsonCavity(j.payload.cavity)}));
    const r=await fetch(base+"/cdm3/ifc/level-solid",{method:"POST",body:fd});if(!r.ok)throw new Error(await r.text());save(j.name,await r.blob());
    setDone(`${tr("Arquivo gerado")}: ${r.headers.get("X-CDM4-Schema")||""} · ${r.headers.get("X-CDM4-Features")||"?"} ${tr("características")} · IfcOpenShell`)}catch(e){setErr(tr("Servidor")+": "+(e?.message||String(e)))}finally{setBusy("")}}
  // 3D (.glb): sólido + foto projetada, em metros, Y para cima
  async function exportGlb(){setErr("");try{const T=three.current;if(!T)return;const{GLTFExporter}=await import("three/addons/exporters/GLTFExporter.js");
    const g=new THREE.Group();for(const m of[...T.solid.children,...T.pic.children,...T.cut.children.filter(c=>!c.material.transparent)]){const c=m.clone();c.material=m.material.clone();c.material.opacity=1;c.material.transparent=false;if(m.userData.layer?.relief){c.geometry=m.geometry.clone();c.geometry.attributes.color.array.set(m.userData.layer.base)}c.matrixAutoUpdate=false;c.matrix.copy(m.matrixWorld);c.matrix.decompose(c.position,c.quaternion,c.scale);c.matrixAutoUpdate=true;g.add(c)}
    const bin=await new GLTFExporter().parseAsync(g,{binary:true});const base=(saved?.image?.name||file?.name||"foto").replace(/\.[^.]+$/,"");
    save(`${base}_CDM4_forma_dano.glb`,new Blob([bin],{type:"model/gltf-binary"}));setDone(tr("Modelo 3D (.glb) baixado"))}catch(e){setErr(e?.message||String(e))}}
  const defaultName=()=>`${(file?.name||"foto").replace(/\.[^.]+$/,"")} · ${curStyle==="relief"?tr("relevo com vales"):tr("camadas planas")}${mode==="ifc"&&face?` · ${face.name}`:""}`;
  async function saveCurrent(){setErr("");setBusy("save");try{
      const T=three.current;let thumbnail=null;if(T){const c=document.createElement("canvas"),src=T.renderer.domElement,s=200/Math.max(src.width,src.height);c.width=Math.round(src.width*s);c.height=Math.round(src.height*s);const x=c.getContext("2d");x.fillStyle="#dce4e7";x.fillRect(0,0,c.width,c.height);x.drawImage(src,0,0,c.width,c.height);thumbnail=c.toDataURL("image/jpeg",.82)}
      const ph=file?await shrinkPhoto(file,1024):null,photoBlob=ph?await new Promise(r=>ph.toBlob(r,"image/jpeg",.85)):null;
      const faceSave={origin:face.origin,ex:face.ex,ey:face.ey,n:face.n,width:face.width,height:face.height,name:face.name,triangles:[]};
      const rec={name:(saveName||defaultName()).trim(),mode,image:{name:file?.name||"",size:file?.size||0},schema:mode==="standalone"?schema:ifc?.schema,
        params:{levels:built.levels,layerMm:built.layerMm,minArea:+minArea,style:curStyle,direction:curDir,detail,cutView,cutIfc,rebar:curDir<0&&rebarOn?{diameter:rebarDia,mode:rebarPos,coverMm:+coverMm}:null},
        solid:built,relief:curStyle==="relief"&&curDir>=0?relief:null,cavity:curDir<0?cavity:null,face:faceSave,map:mapParams,plate:mode==="standalone"?plate:null,
        rw:{prob:rw.prob,W:rw.W,H:rw.H,f:fGrid},photo:photoBlob,thumbnail};
      rec.hostGuid=mode==="ifc"?pick.info.globalId:null;if(mode==="ifc"){rec.ifc={name:ifc.name,schema:ifc.schema,unitM:ifc.unitM,coordination:ifc.coordination,blob:new Blob([ifc.text],{type:"application/x-step"})};rec.hostGuid=pick.info.globalId;rec.faceModel=faceToModel(face,ifc.coordination,ifc.unitM);rec.scaleLabel=fit==="metric"&&metric?metric.label:tr("imagem encaixada na face")}
      const out=await saveLevelSolid(rec);setSaveName("");refreshLibrary();setDone(tr("Sólido salvo")+": "+out.name)}catch(e){setErr(e?.message||String(e))}finally{setBusy("")}}

  if(!active)return null;
  const nFeat=built?.regions?.length||0,canExport=!!(face&&nFeat&&(saved||mode==="standalone"||(ifc&&pick?.info?.globalId)))&&(curDir<0?!!cavity?.regions?.length:(curStyle!=="relief"||!!relief?.regions?.length));
  const outSchema=mode==="standalone"?schema:ifc?.schema||saved?.ifc?.schema||"";
  const selInfo=sel&&built?.regions?(()=>{const[r,t]=sel.slice(1).split(":"),R=built.regions.find(x=>x.id===+r),L=R?.layers.find(x=>x.level===+t);return L?{R,L,area:L.polys.reduce((s,p)=>s+p.area,0)}:null})():null;
  const note=<p className="lstNote"><Info size={15}/><span>{tr("Forma aproximada do dano para identificação visual no modelo. A altura de cada camada é o nível do potencial × a espessura escolhida; não é profundidade medida.")}</span></p>;
  const libraryCard=library.length>0&&<div className="lstLibrary"><header><FolderClock size={15}/><b>{tr("Sólidos salvos")}</b><span>{library.length}</span></header>
    <div className="lstLibraryList">{library.map(r=><div key={r.id} className={"lstLibItem"+(saved?.id===r.id?" active":"")}>
      <button className="lstLibOpen" onClick={()=>openSaved(r.id)} title={tr("Abrir")}>{r.thumbnail?<img src={r.thumbnail} alt=""/>:<span className="lstLibThumb"><Layers size={18}/></span>}
        <span><b>{r.name}</b><small>{when(r.created_at)} · {r.mode==="ifc"?(r.ifcName||"IFC"):tr("sem importar")} · {r.style==="relief"?tr("relevo com vales"):tr("camadas planas")}{r.direction<0?" · "+tr("para dentro"):""}</small></span></button>
      <button className="lstLibDel" onClick={()=>removeSaved(r.id)} title={tr("Excluir")} aria-label={tr("Excluir")+" "+r.name}><Trash2 size={14}/></button></div>)}</div></div>;
  return <section className="lst" aria-label={tr("Sólido de níveis (IFC)")}>
    <header className="lstHead">
      <div className="lstTitle"><span className="lstMark"><Mountain size={16}/></span><div><small>CDM-4 · IFC4 · IFC 4.3</small><b>{tr("Sólido de níveis")}{saved?` · ${saved.name}`:""}</b></div></div>
      {mode&&<div className="lstSeg" role="radiogroup" aria-label={tr("Modo")}>
        <button role="radio" aria-checked={mode==="standalone"&&!saved} className={mode==="standalone"&&!saved?"active":""} onClick={()=>chooseMode("standalone")}><Box size={14}/>{tr("Sem importar")}</button>
        <button role="radio" aria-checked={mode==="ifc"&&!saved} className={mode==="ifc"&&!saved?"active":""} onClick={()=>chooseMode("ifc")}><FolderOpen size={14}/>{tr("Importar IFC")}</button>
        <button role="radio" aria-checked={!!saved} className={saved?"active":""} onClick={()=>{setMode(null);setSaved(null)}}><FolderClock size={14}/>{tr("Salvos")}</button></div>}
      <button className="lstBack" onClick={onClose}><ChevronLeft size={15}/>{tr("Voltar ao canvas")}</button>
    </header>
    {!mode?<div className="lstStart">
      {note}
      <div className="lstChoices">
        <button className="lstChoice" onClick={()=>chooseMode("standalone")}><span className="lstChoiceIcon"><Box size={22}/></span><b>{tr("Gerar sem importar")}</b><span>{tr("Cria um IFC novo com a superfície da foto em escala e as camadas de nível sobre ela. Escolha IFC4 ou IFC 4.3.")}</span></button>
        <button className="lstChoice" onClick={()=>chooseMode("ifc")}><span className="lstChoiceIcon"><FolderOpen size={22}/></span><b>{tr("Importar IFC e gerar")}</b><span>{tr("Abra o modelo da estrutura, clique na face fotografada e as camadas são gravadas no próprio arquivo, ligadas ao elemento.")}</span></button>
      </div>
      {libraryCard}
      {rw===false&&<p className="lstErr">{tr("O random walker não gerou potencial nesta imagem.")}</p>}
      {err&&<p className="lstErr">{err}</p>}
    </div>:
    <div className="lstBody">
      <aside className="lstPanel">
        {note}
        {saved&&<div className="lstStep"><b>{tr("Sólido salvo")}</b>
          <span className="lstValue">{saved.name}</span>
          <small>{when(saved.created_at)} · {saved.image?.name||""}{saved.mode==="ifc"?` · ${saved.ifc?.name} · ${saved.face?.name}`:` · ${fmt(saved.plate?.wmm/1000)} × ${fmt(saved.plate?.hmm/1000)} m`}</small>
          <small>{saved.params.style==="relief"?tr("relevo com vales"):tr("camadas planas")} · {saved.params.direction<0?tr("para dentro"):tr("para fora")} · {tr("níveis")} {saved.params.levels.map(lv).join("; ")} · {fmt(saved.params.layerMm,0)} mm</small>
          {loading>0&&<div className="lstProgress"><i style={{width:loading+"%"}}/></div>}</div>}
        {mode==="ifc"&&!saved&&<div className="lstStep"><b>1 · {tr("Modelo IFC")}</b>
          <label className="lstFile"><FolderOpen size={15}/><span>{ifc?ifc.name:tr("Abrir modelo IFC (IFC4 ou IFC 4.3)")}</span><input type="file" accept=".ifc" onChange={e=>openIfc(e.target.files?.[0])}/></label>
          {loading>0&&<div className="lstProgress"><i style={{width:loading+"%"}}/></div>}
          {ifc&&<small>{ifc.schema} · {ifc.elements} {tr("elementos")} · {tr("unidade")} {ifc.unitM===1?"m":ifc.unitM===.001?"mm":ifc.unitM+" m"}</small>}</div>}
        {mode==="ifc"&&!saved&&ifc&&<div className="lstStep"><b>2 · {tr("Face")}</b>{face&&!pickingFace?<>
          <span className="lstValue">{face.name} · {fmt(face.width)} × {fmt(face.height)} m</span>
          <div className="lstRow"><button onClick={()=>setRot(r=>(r+1)%4)} title={tr("Gira a orientação da foto na face em 90°")}><RotateCw size={14}/>{rot*90}°</button>
            <button onClick={()=>setPickingFace(true)}><SquareDashedMousePointer size={14}/>{tr("Trocar face")}</button></div>
          <label className="lstCheck"><input type="checkbox" checked={mirror} onChange={e=>setMirror(e.target.checked)}/>{tr("Espelhar (foto do lado oposto)")}</label></>
          :<span className="lstHint">{tr("Clique na face do elemento onde a foto foi tirada.")}</span>}</div>}
        {mode==="ifc"&&!saved&&face&&<div className="lstStep"><b>3 · {tr("Posição da foto")}</b>
          <label className="lstCheck"><input type="radio" checked={fit!=="metric"||!metric} onChange={()=>setFit("contain")}/>{tr("Encaixar a imagem na face")}</label>
          <label className="lstCheck" title={metric?"":tr("Defina a escala por 4 pontos no Corte de nível")}><input type="radio" disabled={!metric} checked={fit==="metric"&&!!metric} onChange={()=>setFit("metric")}/>{tr("Usar a escala da foto")}{metric?` (${metric.label})`:" — "+tr("sem escala")}</label>
          <div className="lstRow">{tr("Deslocar")} →<input type="number" value={dx} onChange={e=>setDx(e.target.value)} aria-label={tr("Deslocamento horizontal (mm)")}/>↓<input type="number" value={dy} onChange={e=>setDy(e.target.value)} aria-label={tr("Deslocamento vertical (mm)")}/>mm</div></div>}
        {mode==="standalone"&&!saved&&<div className="lstStep"><b>1 · {tr("Superfície da foto")}</b>
          <select value={size} onChange={e=>setSize(e.target.value)} aria-label={tr("Escala da superfície")}>
            <option value="auto">{tr("Automática")}</option>{metric&&<option value="metric">{tr("Escala da foto (4 pontos)")}</option>}{mmPerPx>0&&<option value="mmpx">{tr("mm/px do motor")}</option>}<option value="width">{tr("Largura real da foto")}</option></select>
          {plate?.kind==="width"&&<div className="lstRow">{tr("Largura")}<input type="number" min="1" value={widthMm} onChange={e=>setWidthMm(e.target.value)} aria-label={tr("Largura real da foto (mm)")}/>mm</div>}
          {plate&&<span className="lstValue">{fmt(plate.wmm/1000)} × {fmt(plate.hmm/1000)} m · {plate.label}</span>}</div>}
        {face&&!saved&&<div className="lstStep"><b>{mode==="ifc"?"4":"2"} · {tr("Camadas")}</b>
          <span className="lstLabel">{tr("Forma")}</span>
          <div className="lstSeg small" role="radiogroup" aria-label={tr("Forma")}>
            <button role="radio" aria-checked={style==="terraces"} className={style==="terraces"?"active":""} onClick={()=>setStyle("terraces")}>{tr("Camadas planas")}</button>
            <button role="radio" aria-checked={style==="relief"} className={style==="relief"?"active":""} onClick={()=>setStyle("relief")}>{tr("Relevo com vales")}</button></div>
          <span className="lstLabel">{tr("Sentido")}</span>
          <div className="lstSeg small" role="radiogroup" aria-label={tr("Sentido")}>
            <button role="radio" aria-checked={direction>0} className={direction>0?"active":""} onClick={()=>setDirection(1)}>{tr("Convexa (para fora)")}</button>
            <button role="radio" aria-checked={direction<0} className={direction<0?"active":""} onClick={()=>setDirection(-1)}>{tr("Côncava (cavidade)")}</button></div>
          {direction<0&&<><span className="lstLabel">{tr("Interseção com o elemento")}</span>
            <div className="lstSeg small" role="radiogroup" aria-label={tr("Interseção com o elemento")}>
              <button role="radio" aria-checked={cutView==="hidden"} className={cutView==="hidden"?"active":""} onClick={()=>setCutView("hidden")}>{tr("Oculta (recorte)")}</button>
              <button role="radio" aria-checked={cutView==="transparent"} className={cutView==="transparent"?"active":""} onClick={()=>setCutView("transparent")}>{tr("Transparente")}</button></div>
            <label className="lstCheck"><input type="checkbox" checked={cutIfc} onChange={e=>setCutIfc(e.target.checked)}/>{tr("Recortar o elemento no IFC exportado")}</label>
            <small>{cutIfc?tr("O recorte é um IfcVoidingFeature separado, ligado por IfcRelVoidsElement: a geometria do elemento não muda e apagar o recorte restaura a vista original."):tr("Sem recorte no IFC: o fundo colorido fica dentro do elemento e só aparece com o elemento transparente.")}</small>
            <label className="lstCheck" title={rebarLines?.length?"":tr("Nenhuma armadura exposta detectada nesta imagem")}><input type="checkbox" disabled={!rebarLines?.length} checked={rebarOn&&!!rebarLines?.length} onChange={e=>setRebarOn(e.target.checked)}/>{tr("Projetar armadura exposta")}{rebarLines?` (${rebarLines.length} ${tr("trechos detectados")})`:""}</label>
            {rebarOn&&rebarLines?.length>0&&<>
              <div className="lstRow">{tr("Diâmetro")}<select className="inline" value={rebarDia} onChange={e=>setRebarDia(e.target.value)} aria-label={tr("Diâmetro da armadura")}>
                <option value="auto">{tr("Automático (largura detectada)")}</option>{REBAR_GAUGES.map(g=><option key={g} value={g}>Ø {lv(g)} mm</option>)}</select></div>
              <div className="lstSeg small" role="radiogroup" aria-label={tr("Posição da armadura")}>
                <button role="radio" aria-checked={rebarPos==="floor"} className={rebarPos==="floor"?"active":""} onClick={()=>setRebarPos("floor")}>{tr("Sobre o fundo")}</button>
                <button role="radio" aria-checked={rebarPos==="cover"} className={rebarPos==="cover"?"active":""} onClick={()=>setRebarPos("cover")}>{tr("Cobrimento fixo")}</button></div>
              {rebarPos==="cover"&&<div className="lstRow">{tr("Cobrimento")}<input type="number" min="0" value={coverMm} onChange={e=>setCoverMm(e.target.value)} aria-label={tr("Cobrimento (mm)")}/>mm</div>}
              <small>{rebarPos==="cover"?tr("Eixo da barra a cobrimento + Ø/2 da face: a barra só aparece onde a cavidade é mais funda que ela, como numa inspeção real."):tr("A barra acompanha o fundo da cavidade, levemente embutida, para ficar sempre visível.")} {tr("Posição e diâmetro aproximados, a partir da máscara de armadura exposta do CDM-4.")}</small></>}
            {cutState==="outside"&&<p className="lstErr">{tr("A cavidade passa da borda da face: na vista o elemento fica translúcido; o recorte no IFC continua.")}</p>}</>}
          <div className="lstRow">{tr("Níveis do walker")}<input className="wide" value={levels} onChange={e=>setLevels(e.target.value)} aria-label={tr("Níveis do walker")}/></div>
          <div className="lstRow">{tr("Espessura por camada")}<input type="number" min=".1" value={layerMm} onChange={e=>setLayerMm(e.target.value)} aria-label={tr("Espessura por camada (mm)")}/>mm</div>
          <div className="lstRow">{tr("Área mínima")}<input type="number" min="0" step=".5" value={minArea} onChange={e=>setMinArea(e.target.value)} aria-label={tr("Área mínima (dm²)")}/>dm²</div>
          {(style==="relief"||direction<0)&&<div className="lstRow">{tr("Detalhe do relevo")}<select className="inline" value={detail} onChange={e=>setDetail(e.target.value)} aria-label={tr("Detalhe do relevo")}>
            <option value="alto">{tr("Alto")}</option><option value="medio">{tr("Médio")}</option><option value="baixo">{tr("Baixo")}</option></select></div>}
          {style==="relief"&&relief&&<small>{tr("Altura contínua: zero na curva do nível mais baixo, máxima em u = 1; vales onde o potencial cai.")} {relief.regions.reduce((s,r)=>s+r.topCount,0).toLocaleString(loc())} {tr("triângulos no topo")} · {tr("passo")} {relief.stride}</small>}
          {built?.error&&<p className="lstErr">{built.error}</p>}</div>}
        {face&&<div className="lstStep"><b>{saved?"":(mode==="ifc"?"5":"3")+" · "}{tr("Salvar e exportar")}</b>
          {!saved&&<><div className="lstRow"><input className="full" value={saveName} placeholder={defaultName()} onChange={e=>setSaveName(e.target.value)} aria-label={tr("Nome do sólido")}/></div>
            <button className="lstSecondary" disabled={!canExport||busy==="save"} onClick={saveCurrent}><Save size={14}/>{busy==="save"?tr("Salvando…"):tr("Salvar sólido")}</button></>}
          {mode==="standalone"&&<div className="lstSeg small" role="radiogroup" aria-label={tr("Esquema IFC")}>{["IFC4X3","IFC4"].map(s=><button key={s} role="radio" aria-checked={schema===s} className={schema===s?"active":""} onClick={()=>setSchema(s)}>{s==="IFC4X3"?"IFC 4.3":"IFC4"}</button>)}</div>}
          <button className="lstPrimary" disabled={!canExport} onClick={exportBrowser}><Download size={14}/>{tr("IFC (no navegador)")}</button>
          {serverEndpoint&&<button className="lstSecondary" disabled={!canExport||busy==="server"} onClick={exportServer}><Server size={14}/>{busy==="server"?tr("Enviando…"):tr("IFC (servidor · IfcOpenShell)")}</button>}
          <button className="lstSecondary" disabled={!canExport} onClick={exportGlb}><Box size={14}/>{tr("Modelo 3D (.glb)")}</button>
          {saved&&<button className="lstDanger" onClick={()=>removeSaved(saved.id)}><Trash2 size={14}/>{tr("Excluir sólido salvo")}</button>}
          <small>{/X3/i.test(outSchema)?tr("IFC 4.3: IfcSurfaceFeature DEFECT ligada ao elemento por IfcRelAdheresToElement."):tr("IFC4: IfcSurfaceFeature USERDEFINED (DEFECT) ligada ao elemento por IfcRelAggregates.")}{curStyle==="relief"?" "+tr("Relevo gravado como IfcTriangulatedFaceSet, com cores por faixa de nível."):""}</small></div>}
        {done&&<p className="lstOk">{done}</p>}
        {err&&<p className="lstErr">{err}</p>}
      </aside>
      <div className="lstView" ref={host}>
        <div className="lstToolbar"><button onClick={()=>fitView(three.current?.model?.children.length?three.current.model:three.current?.solid)} title={tr("Enquadrar")} aria-label={tr("Enquadrar")}><Maximize2 size={15}/></button>
          <button className={showPhoto?"active":""} onClick={()=>setShowPhoto(v=>!v)} title={tr("Foto na face")} aria-label={tr("Foto na face")} aria-pressed={showPhoto}><ImageIcon size={15}/></button>
          <span className="lstToolSep"/>
          <button className={viewMenu?"active":""} disabled={!face} onClick={()=>{setViewMenu(v=>!v);setShotMenu(false)}} title={tr("Vistas")} aria-label={tr("Vistas")} aria-expanded={viewMenu}><Rotate3d size={15}/></button>
          <button className={shotMenu?"active":""} disabled={!face} onClick={()=>{setShotMenu(v=>!v);setViewMenu(false)}} title={tr("Exportar imagem da vista")} aria-label={tr("Exportar imagem da vista")} aria-expanded={shotMenu}><ImageDown size={15}/></button></div>
        {viewMenu&&face&&<div className="lstPop lstViews" role="dialog" aria-label={tr("Vistas")}>
          <b>{tr("Vistas padrão")}</b>
          <div className="lstViewGrid">{[["front",tr("Frente")],["top",tr("Topo")],["bottom",tr("Base")],["left",tr("Esquerda")],["right",tr("Direita")],["iso",tr("Isométrica")]].map(([id,l])=><button key={id} className={activeView===id?"active":""} onClick={()=>goView(id)}>{l}</button>)}</div>
          <b>{tr("Inclinada (profundidade em perspectiva)")}</b>
          <label className="lstSlider"><span>{tr("Inclinação")}</span><input type="range" min="0" max="85" value={tilt} onChange={e=>{const t=+e.target.value;setTilt(t);goView("tilt",t,azim)}}/><em>{tilt}°</em></label>
          <label className="lstSlider"><span>{tr("Rotação")}</span><input type="range" min="-180" max="180" value={azim} onChange={e=>{const a=+e.target.value;setAzim(a);goView("tilt",tilt,a)}}/><em>{azim}°</em></label>
          <div className="lstViewGrid">{[[30,0],[45,30],[60,-30],[75,45]].map(([t,a])=><button key={t+"/"+a} onClick={()=>{setTilt(t);setAzim(a);goView("tilt",t,a)}}>{t}° · {a}°</button>)}</div>
          <small>{tr("Inclinação: ângulo a partir da frente, em direção ao topo da face. Rotação: giro em torno da normal da face. Vistas rasantes realçam o relevo e a profundidade da cavidade.")}</small></div>}
        {shotMenu&&face&&<div className="lstPop lstShot" role="dialog" aria-label={tr("Exportar imagem da vista")}>
          <b>{tr("Imagem da vista atual (PNG)")}</b>
          <div className="lstViewGrid two">{[2,3,4].map(k=><button key={k} onClick={()=>exportShot(k)}>{k}× · {(()=>{const r=three.current?.renderer?.getSize?.(new THREE.Vector2());return r?`${Math.round(r.x*k)} × ${Math.round(r.y*k)}`:""})()}</button>)}</div>
          <label className="lstCheck"><input type="checkbox" checked={shotLegend} onChange={e=>setShotLegend(e.target.checked)}/>{tr("Com legenda ao lado (níveis e ressalva)")}</label></div>}
        {mode==="ifc"&&!saved&&!ifc&&!loading&&<div className="lstEmpty"><FolderOpen size={30}/><b>{tr("Abra o IFC da estrutura para posicionar o sólido.")}</b></div>}
        {mode==="ifc"&&!saved&&ifc&&pickingFace&&<div className="lstBanner"><Crosshair size={14}/>{tr("Clique na face do elemento onde a foto foi tirada.")}</div>}
        {built?.regions&&<div className="lstLayers" aria-label={tr("Camadas geradas")}>
          <header><b>{tr("Camadas geradas")}</b><span>{nFeat} {tr("regiões")} · {built.regions.reduce((s,R)=>s+R.layers.length,0)} {tr("camadas")}{curStyle==="relief"?" · "+tr("relevo com vales"):""}</span></header>
          <div className="lstLayerList">{built.regions.map(R=><div key={R.id} className="lstRegion"><div className="lstRegionHead"><b>R{R.id}</b><span>{fmt((R.areaByLevel[0]?.area_mm2||0)/1e6,3)} m²</span></div>
            {R.layers.map(L=>{const k=keyOf(R.id,L.level),c=levelColor(built.levels.indexOf(L.level),built.levels.length).map(v=>Math.round(v*255)),a=L.polys.reduce((s,p)=>s+p.area,0);
              return <button key={k} className={"lstLayer"+(sel===k?" active":"")} aria-pressed={sel===k} onClick={()=>{setSel(s=>s===k?null:k);setPoint(null)}}><i style={{background:`rgb(${c})`}}/><span>u ≥ {lv(L.level)}</span><small>{fmt(a/1e6,3)} m² · {fmt(L.z1,0)} mm</small></button>})}</div>)}</div>
          {!point&&<p className="lstLayerHint">{tr("Clique num ponto da face ou do sólido para achar a camada correspondente.")}</p>}
        </div>}
        {(point||selInfo)&&<div className="lstPoint" role="status">
          {point&&<div><span>{tr("Ponto na face")}</span><b>{fmt(point.u/1000)} · {fmt(point.v/1000)} m</b></div>}
          {point&&<div><span>{tr("Potencial do walker")}</span><b>{point.pot==null?"—":fmt(point.pot,2)}{point.pot!=null&&(()=>{const top=point.layers.at(-1)?.level??0,nxt=built?.levels?.find(t=>t>top);return point.pot<top||(nxt!=null&&point.pot>=nxt)})()?<em className="lstEdge"> · {tr("na borda da camada")}</em>:null}</b></div>}
          {point&&!point.layers.length&&<div><span>{tr("Camada")}</span><b>{tr("fora das camadas")}</b></div>}
          {selInfo&&<div><span>{tr("Camada")}</span><b>R{selInfo.R.id} · u ≥ {lv(selInfo.L.level)}</b></div>}
          {selInfo&&<div><span>{curDir<0?tr("Altura abaixo da face"):tr("Altura acima da face")}</span><b>{fmt(selInfo.L.z0,0)}–{fmt(selInfo.L.z1,0)} mm</b></div>}
          {selInfo&&<div><span>{tr("Área da camada")}</span><b>{fmt(selInfo.area/1e6,3)} m²</b></div>}
          {point?.layers.length>1&&<div><span>{tr("Camadas no ponto")}</span><b>{point.layers.map(x=>lv(x.level)).join(" · ")}</b></div>}
          {point?.rebar&&<div><span>{tr("Armadura")}</span><b>Ø {lv(point.rebar.d)} mm{rebarDia==="auto"&&!saved?` (${tr("detectado")} ≈ ${fmt(point.rebar.dEst,1)} mm)`:""}</b></div>}
          {face&&<div><span>{tr("Face")}</span><b>{face.name}</b></div>}
        </div>}
      </div>
    </div>}
  </section>;
}
