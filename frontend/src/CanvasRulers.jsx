import React,{useEffect,useRef}from"react";

// Réguas horizontal e vertical do canvas, no estilo Inkscape.
// A origem (0) é o canto superior esquerdo da imagem; as marcas acompanham zoom e pan.
// Unidades: mm e cm exigem a escala mm/px (calibração); sem ela, as réguas mostram px da imagem.
export const RULER_SIZE=20;
export const RULER_UNITS=["mm","cm","px"];

const STEPS=[1,2,5];
export function rulerStep(pxPerUnit,minMajorPx=64){
  // Menor passo "redondo" (1·2·5×10^k) cujas marcas principais ficam a pelo menos minMajorPx.
  if(!(pxPerUnit>0))return null;
  const raw=minMajorPx/pxPerUnit;let k=Math.floor(Math.log10(raw))-1;
  for(;;k++)for(const m of STEPS){const step=m*10**k;if(step>=raw){
    const sub=step*pxPerUnit/10>=5?10:step*pxPerUnit/5>=5?5:2;
    return{major:step,sub};
  }}
}
export function unitPerImagePx(unit,mmPerPx){
  if(unit==="px"||!(mmPerPx>0))return{unit:"px",factor:1};
  return unit==="cm"?{unit:"cm",factor:mmPerPx/10}:{unit:"mm",factor:mmPerPx};
}
function formatValue(v,step){
  const decimals=Math.max(0,Math.min(4,-Math.floor(Math.log10(step)+1e-9)));
  const n=Math.abs(v)<step*1e-6?0:v;
  return n.toLocaleString("pt-BR",{minimumFractionDigits:0,maximumFractionDigits:decimals});
}

function imageContentRect(vp){
  const img=vp.querySelector(".editorImage .editorBaseImage");
  if(!img||!img.naturalWidth)return null;
  const r=img.getBoundingClientRect(),nw=img.naturalWidth,nh=img.naturalHeight;
  const s=Math.min(r.width/nw,r.height/nh);if(!(s>0))return null;
  const w=nw*s,h=nh*s;
  return{left:r.left+(r.width-w)/2,top:r.top+(r.height-h)/2,width:w,height:h,scale:s,nw,nh};
}

function drawRuler(canvas,{length,origin,pxPerUnit,horizontal,extentStart,extentEnd,cursor,step}){
  const dpr=window.devicePixelRatio||1,W=horizontal?length:RULER_SIZE,H=horizontal?RULER_SIZE:length;
  if(canvas.width!==Math.round(W*dpr)||canvas.height!==Math.round(H*dpr)){canvas.width=Math.round(W*dpr);canvas.height=Math.round(H*dpr)}
  canvas.style.width=W+"px";canvas.style.height=H+"px";
  const ctx=canvas.getContext("2d");ctx.setTransform(dpr,0,0,dpr,0,0);
  ctx.fillStyle="#eef3f5";ctx.fillRect(0,0,W,H);
  // Faixa da imagem em branco (como a página no Inkscape).
  if(extentEnd>extentStart){ctx.fillStyle="#ffffff";const a=Math.max(0,extentStart),b=Math.min(length,extentEnd);if(b>a){if(horizontal)ctx.fillRect(a,0,b-a,H);else ctx.fillRect(0,a,W,b-a)}}
  ctx.strokeStyle="#c3d0d5";ctx.lineWidth=1;ctx.beginPath();
  if(horizontal){ctx.moveTo(0,H-.5);ctx.lineTo(W,H-.5)}else{ctx.moveTo(W-.5,0);ctx.lineTo(W-.5,H)}ctx.stroke();
  if(step){
    const minor=step.major/step.sub,first=Math.floor((0-origin)/pxPerUnit/minor)-1,last=Math.ceil((length-origin)/pxPerUnit/minor)+1;
    ctx.strokeStyle="#6f8692";ctx.fillStyle="#3f5662";ctx.font="600 9px system-ui,sans-serif";ctx.beginPath();
    for(let i=first;i<=last;i++){
      const p=Math.round(origin+i*minor*pxPerUnit)+.5;if(p<-1||p>length+1)continue;
      const isMajor=i%step.sub===0,isMid=!isMajor&&step.sub%2===0&&i%(step.sub/2)===0;
      const len=isMajor?RULER_SIZE-4:isMid?8:4;
      if(horizontal){ctx.moveTo(p,H);ctx.lineTo(p,H-len)}else{ctx.moveTo(W,p);ctx.lineTo(W-len,p)}
    }
    ctx.stroke();
    for(let i=Math.floor(first/step.sub)*step.sub;i<=last;i+=step.sub){
      if(i%step.sub!==0)continue;
      const p=Math.round(origin+i*minor*pxPerUnit);if(p<-40||p>length+2)continue;
      const label=formatValue(i*minor,step.major);
      if(horizontal){ctx.textBaseline="top";ctx.fillText(label,p+3,2)}
      else{ctx.save();ctx.translate(2,p-3);ctx.rotate(-Math.PI/2);ctx.textBaseline="top";ctx.fillText(label,0,0);ctx.restore()}
    }
  }
  if(cursor!=null&&cursor>=0&&cursor<=length){
    ctx.strokeStyle="#d0453c";ctx.lineWidth=1;ctx.beginPath();const c=Math.round(cursor)+.5;
    if(horizontal){ctx.moveTo(c,0);ctx.lineTo(c,H)}else{ctx.moveTo(0,c);ctx.lineTo(W,c)}ctx.stroke();
  }
}

export default function CanvasRulers({viewportRef,mmPerPx=0,unit="mm",onCycleUnit}){
  const topRef=useRef(null),leftRef=useRef(null),readoutEl=useRef(null);
  // Coordenadas do cursor escritas direto no DOM (sem re-render do Studio a cada movimento).
  const readoutRef=useRef(null);readoutRef.current=r=>{
    const el=readoutEl.current;if(!el)return;
    if(!r){el.hidden=true;return}
    const d=r.unit==="px"?1:r.unit==="cm"?2:1,f=v=>v.toLocaleString("pt-BR",{minimumFractionDigits:d,maximumFractionDigits:d});
    el.hidden=false;el.textContent="X "+f(r.x)+"  Y "+f(r.y)+" "+r.unit;el.classList.toggle("outside",!r.inside);
  };
  useEffect(()=>{
    const vp=viewportRef.current;if(!vp)return;
    let raf=0,lastKey="",cursor=null;
    const onMove=e=>{const v=vp.getBoundingClientRect();cursor={x:e.clientX-v.left,y:e.clientY-v.top}};
    const onLeave=()=>{cursor=null};
    vp.addEventListener("pointermove",onMove);vp.addEventListener("pointerleave",onLeave);
    const tick=()=>{
      raf=requestAnimationFrame(tick);
      const top=topRef.current,left=leftRef.current;if(!top||!left)return;
      const v=vp.getBoundingClientRect(),img=imageContentRect(vp),u=unitPerImagePx(unit,mmPerPx);
      const key=[v.width,v.height,img?.left,img?.top,img?.scale,cursor?.x,cursor?.y,u.unit,u.factor].join("|");
      if(key===lastKey)return;lastKey=key;
      const lenX=Math.max(0,v.width-RULER_SIZE),lenY=Math.max(0,v.height-RULER_SIZE);
      if(!img){
        drawRuler(top,{length:lenX,origin:0,pxPerUnit:0,horizontal:true,extentStart:0,extentEnd:0,cursor:null,step:null});
        drawRuler(left,{length:lenY,origin:0,pxPerUnit:0,horizontal:false,extentStart:0,extentEnd:0,cursor:null,step:null});
        readoutRef.current?.(null);return;
      }
      const pxPerUnit=img.scale/u.factor,step=rulerStep(pxPerUnit);
      const ox=img.left-v.left-RULER_SIZE,oy=img.top-v.top-RULER_SIZE;
      drawRuler(top,{length:lenX,origin:ox,pxPerUnit,horizontal:true,extentStart:ox,extentEnd:ox+img.width,cursor:cursor?cursor.x-RULER_SIZE:null,step});
      drawRuler(left,{length:lenY,origin:oy,pxPerUnit,horizontal:false,extentStart:oy,extentEnd:oy+img.height,cursor:cursor?cursor.y-RULER_SIZE:null,step});
      if(cursor){
        const ix=(cursor.x-(img.left-v.left))/img.scale,iy=(cursor.y-(img.top-v.top))/img.scale;
        readoutRef.current?.({x:ix*u.factor,y:iy*u.factor,unit:u.unit,inside:ix>=0&&iy>=0&&ix<=img.nw&&iy<=img.nh});
      }else readoutRef.current?.(null);
    };
    raf=requestAnimationFrame(tick);
    return()=>{cancelAnimationFrame(raf);vp.removeEventListener("pointermove",onMove);vp.removeEventListener("pointerleave",onLeave)};
  },[viewportRef,mmPerPx,unit]);
  const effective=unitPerImagePx(unit,mmPerPx).unit,uncalibrated=unit!=="px"&&!(mmPerPx>0);
  return <>
    <button type="button" className={"canvasRulerCorner"+(uncalibrated?" warn":"")} onClick={onCycleUnit} title={uncalibrated?"Sem escala mm/px: réguas em pixels da imagem. Defina a escala em Configurações → Réguas e escala.":"Unidade das réguas: "+effective+" · clique para alternar (mm → cm → px)"} aria-label={"Unidade das réguas: "+effective}>{effective}</button>
    <canvas ref={topRef} className="canvasRuler horizontal" aria-hidden="true"/>
    <canvas ref={leftRef} className="canvasRuler vertical" aria-hidden="true"/>
    <output ref={readoutEl} className="canvasRulerReadout" hidden aria-live="off"/>
  </>;
}
