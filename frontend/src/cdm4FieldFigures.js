// Figuras da ferramenta "Campo do walker": quatro quadros do MESMO tamanho (padrão 640 × 640),
// com a mesma banda inferior translúcida das Etapas (título + legenda horizontal) e no idioma ativo.
import{composeStage,ramp}from"./engineStages.js";
import{tr,getLang}from"./i18n.js";
import{surface}from"./svgCanvas.js";

export const FIELD_FIGURE_SIZE=640;
const VIRIDIS=[[68,1,84],[59,82,139],[33,145,140],[94,201,98],[253,231,37]];
const MAGMA=[[0,0,4],[59,15,112],[140,41,129],[222,73,104],[254,159,109],[252,253,191]];
const num=(v,d=2)=>{const t=Number(v).toFixed(d);return getLang()==="en"?t:t.replace(".",",")};
function canvas(w,h){const c=document.createElement("canvas");c.width=w;c.height=h;return c}
function cropCanvas(F){const c=canvas(F.n,F.n);c.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(F.img),F.n,F.n),0,0);c.__photo=true;return c}
// contorno de uma máscara binária desenhado como arestas entre pixel dentro/fora
function drawContour(ctx,mask,n,s,color,width,dash=null){
  ctx.save();ctx.strokeStyle=color;ctx.lineWidth=width;if(dash)ctx.setLineDash(dash);ctx.beginPath();
  for(let y=0;y<n;y++)for(let x=0;x<n;x++){const i=y*n+x;if(!mask[i])continue;
    if(x===n-1||!mask[i+1]){ctx.moveTo((x+1)*s,y*s);ctx.lineTo((x+1)*s,(y+1)*s)}
    if(x===0||!mask[i-1]){ctx.moveTo(x*s,y*s);ctx.lineTo(x*s,(y+1)*s)}
    if(y===n-1||!mask[i+n]){ctx.moveTo(x*s,(y+1)*s);ctx.lineTo((x+1)*s,(y+1)*s)}
    if(y===0||!mask[i-n]){ctx.moveTo(x*s,y*s);ctx.lineTo((x+1)*s,y*s)}}
  ctx.stroke();ctx.restore();
}
function base(F,S,dim=.25){
  const c=surface(S,S),ctx=c.getContext("2d");ctx.imageSmoothingEnabled=F.n<S;ctx.drawImage(cropCanvas(F),0,0,S,S);
  if(dim>0){ctx.fillStyle="rgba(10,20,28,"+dim+")";ctx.fillRect(0,0,S,S)}return{c,ctx,s:S/F.n};
}
function compose(label,src,S){return composeStage({label},src,S,S)}

// 1 · zoom com a malha de setas −∇u (cerca de 20 × 20) e legenda log10 |∇u|
export function figureArrows(F,S=FIELD_FIGURE_SIZE){
  const{c,ctx,s}=base(F,S,.2),N=F.n,grid=20,cell=N/grid;
  const ov=canvas(N,N),oc=ov.getContext("2d"),od=oc.createImageData(N,N);
  for(let i=0;i<N*N;i++){if(F.seedD[i]){od.data[4*i]=255;od.data[4*i+1]=150;od.data[4*i+2]=0;od.data[4*i+3]=90}else if(F.seedH[i]){od.data[4*i]=40;od.data[4*i+1]=170;od.data[4*i+2]=90;od.data[4*i+3]=28}}
  oc.putImageData(od,0,0);ctx.imageSmoothingEnabled=false;ctx.drawImage(ov,0,0,S,S);
  const vals=[];for(let i=0;i<N*N;i++)if(F.trans[i])vals.push(Math.log10(F.mag[i]+1e-9));vals.sort((a,b)=>a-b);
  const lo=vals.length?vals[Math.floor(vals.length*.05)]:-4,hi=vals.length?vals[Math.floor(vals.length*.95)]:-1,span=Math.max(1e-6,hi-lo);
  const len=S/grid*.42;ctx.lineCap="round";
  for(let gy=0;gy<grid;gy++)for(let gx=0;gx<grid;gx++){
    const x=Math.min(N-1,Math.floor((gx+.5)*cell)),y=Math.min(N-1,Math.floor((gy+.5)*cell)),i=y*N+x;
    if(!F.trans[i]||F.mag[i]<=0)continue;
    const ux=F.vx[i]/F.mag[i],uy=F.vy[i]/F.mag[i],cx=(gx+.5)*S/grid,cy=(gy+.5)*S/grid,[r,g,b]=ramp(VIRIDIS,(Math.log10(F.mag[i]+1e-9)-lo)/span);
    const x0=cx-ux*len,y0=cy-uy*len,x1=cx+ux*len,y1=cy+uy*len,col="rgb("+r+","+g+","+b+")";
    ctx.strokeStyle=col;ctx.fillStyle=col;ctx.lineWidth=Math.max(1.5,S/420);ctx.beginPath();ctx.moveTo(x0,y0);ctx.lineTo(x1,y1);ctx.stroke();
    const hl=len*.55,a=Math.atan2(uy,ux);ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x1-hl*Math.cos(a-.45),y1-hl*Math.sin(a-.45));ctx.lineTo(x1-hl*Math.cos(a+.45),y1-hl*Math.sin(a+.45));ctx.closePath();ctx.fill();
  }
  drawContour(ctx,F.engine,N,s,"#00e5ff",Math.max(1.5,S/360),[S/80,S/120]);
  drawContour(ctx,F.local,N,s,"#ffffff",Math.max(1.5,S/360));
  c.__legend={stops:VIRIDIS,min:lo,max:hi,ticks:[lo,lo+span/2,hi].map(v=>+v.toFixed(1)),title:tr("Intensidade log₁₀ |∇u|"),subtitle:tr("ciano tracejado = motor · branco = resolução cheia")};
  return compose(tr("Campo do walker · setas −∇u"),c,S);
}

// 2 · rosa do desvio angular (0° = saindo do polo de dano), ponderada por |∇u|
export function figureRose(F,S=FIELD_FIGURE_SIZE){
  const c=surface(S,S),ctx=c.getContext("2d");ctx.fillStyle="#12202a";ctx.fillRect(0,0,S,S);
  const cx=S/2,cy=S*.44,Rm=S*.34,h=F.hist,mx=Math.max(1e-12,...h),nb=h.length;
  ctx.strokeStyle="rgba(255,255,255,.18)";ctx.lineWidth=1;for(const f of [.25,.5,.75,1]){ctx.beginPath();ctx.arc(cx,cy,Rm*f,0,2*Math.PI);ctx.stroke()}
  for(let a=0;a<360;a+=45){const t=a*Math.PI/180;ctx.beginPath();ctx.moveTo(cx,cy);ctx.lineTo(cx+Rm*Math.sin(t),cy-Rm*Math.cos(t));ctx.stroke()}
  for(let b=0;b<nb;b++){
    const a0=-Math.PI+b*2*Math.PI/nb,a1=a0+2*Math.PI/nb,r=Rm*Math.sqrt(h[b]/mx);
    ctx.beginPath();ctx.moveTo(cx,cy);for(let t=a0;t<=a1+1e-9;t+=(a1-a0)/6)ctx.lineTo(cx+r*Math.sin(t),cy-r*Math.cos(t));ctx.closePath();
    ctx.fillStyle="rgba(13,170,155,.88)";ctx.fill();ctx.strokeStyle="rgba(255,255,255,.55)";ctx.stroke();
  }
  // vetor médio
  ctx.strokeStyle="#ffd27a";ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(cx,cy);ctx.lineTo(cx,cy-Rm*F.R);ctx.stroke();
  ctx.fillStyle="#e7f0f2";ctx.font="600 "+Math.round(S*.024)+"px Inter,system-ui,sans-serif";ctx.textAlign="center";
  for(const[a,t]of [[0,"0°"],[90,"90°"],[180,"180°"],[270,"−90°"]]){const r=Rm+S*.035,ang=a*Math.PI/180;ctx.fillText(t,cx+r*Math.sin(ang),cy-r*Math.cos(ang)+S*.008)}
  ctx.font=Math.round(S*.022)+"px Inter,system-ui,sans-serif";ctx.fillStyle="rgba(231,240,242,.8)";ctx.fillText(tr("0° = saindo do polo de dano"),cx,cy-Rm-S*.065);
  ctx.fillStyle="#ffd27a";ctx.fillText(tr("amarelo = vetor médio (comprimento R)"),cx,cy+Rm+S*.07);
  return compose(tr("Desvio angular")+" · R = "+num(F.R)+" · "+tr("variância circular")+" = "+num(F.circVar),c,S);
}

// 3 · dispersão local 1 − R (janela 9 × 9) com legenda 0–1
export function figureDispersion(F,S=FIELD_FIGURE_SIZE){
  const{c,ctx,s}=base(F,S,.45),N=F.n,ov=canvas(N,N),oc=ov.getContext("2d"),od=oc.createImageData(N,N);
  for(let i=0;i<N*N;i++){const v=F.disp[i];if(Number.isNaN(v))continue;const[r,g,b]=ramp(MAGMA,v);od.data[4*i]=r;od.data[4*i+1]=g;od.data[4*i+2]=b;od.data[4*i+3]=235}
  oc.putImageData(od,0,0);ctx.imageSmoothingEnabled=false;ctx.drawImage(ov,0,0,S,S);
  drawContour(ctx,F.local,N,s,"#00e5ff",Math.max(1.5,S/360));
  c.__legend={stops:MAGMA,min:0,max:1,ticks:[0,.25,.5,.75,1],title:tr("Dispersão local 1 − R"),subtitle:tr("0 = setas alinhadas · 1 = direções espalhadas")};
  return compose(tr("Dispersão local da direção"),c,S);
}

// 4 · tabela de coerência por região
export function figureTable(F,S=FIELD_FIGURE_SIZE){
  const c=surface(S,S),ctx=c.getContext("2d");ctx.fillStyle="#12202a";ctx.fillRect(0,0,S,S);
  const fs=Math.round(S*.025),pad=Math.round(S*.05);let y=pad+fs;
  ctx.fillStyle="#e7f0f2";ctx.font="600 "+Math.round(fs*1.05)+"px Inter,system-ui,sans-serif";ctx.textAlign="left";
  ctx.fillText(tr("Área selecionada")+": "+F.roi.size+" × "+F.roi.size+" px · ("+F.roi.x+", "+F.roi.y+")",pad,y);y+=fs*1.5;
  ctx.font=Math.round(fs*.9)+"px Inter,system-ui,sans-serif";ctx.fillStyle="rgba(231,240,242,.78)";
  ctx.fillText(tr("Walker em resolução cheia")+(F.k>1?" (1/"+F.k+")":"")+" · R "+tr("global")+" = "+num(F.R)+" · "+F.ms+" ms",pad,y);y+=fs*2;
  const Q=F.iou;
  if(Q){
    const pc=v=>v==null?"—":(v*100).toFixed(1).replace(".",getLang()==="en"?".":",")+" %";
    ctx.fillStyle="#9fc9c4";ctx.font="700 "+Math.round(fs*.9)+"px Inter,system-ui,sans-serif";
    ctx.fillText(Q.mode==="gt"?tr("IoU na seleção (contra o GT anotado)"):tr("IoU na seleção (sem GT: concordância motor × cheia)"),pad,y);y+=fs*1.5;
    ctx.font=Math.round(fs*.9)+"px Inter,system-ui,monospace";ctx.fillStyle="#e7f0f2";
    if(Q.mode==="gt"){
      const cx=[0,.34,.56,.78].map(f=>pad+f*(S-2*pad));
      ctx.fillStyle="rgba(231,240,242,.7)";["",tr("IoU"),tr("Precisão"),tr("Revocação")].forEach((t,i)=>ctx.fillText(t,cx[i],y));y+=fs*1.4;
      for(const[lab,m]of[[tr("Motor"),Q.engine],[tr("Resolução cheia"),Q.full]]){ctx.fillStyle=m===Q.full&&Q.full.iou>Q.engine.iou?"#8ff0b4":"#e7f0f2";[lab,pc(m.iou),pc(m.precision),pc(m.recall)].forEach((t,i)=>ctx.fillText(t,cx[i],y));y+=fs*1.4}
      ctx.fillStyle="rgba(231,240,242,.7)";ctx.fillText(tr("Ganho")+": "+((Q.full.iou-Q.engine.iou)*100>=0?"+":"")+((Q.full.iou-Q.engine.iou)*100).toFixed(1)+" pp",pad,y);y+=fs*1.9;
    }else{
      ctx.fillText(tr("IoU motor × cheia")+": "+pc(Q.agreement)+"   ·   "+tr("Δ área")+": "+(Q.area_delta==null?"—":(Q.area_delta>=0?"+":"")+(Q.area_delta*100).toFixed(1)+" %"),pad,y);y+=fs*1.4;
      ctx.fillStyle="rgba(231,240,242,.7)";ctx.font=Math.round(fs*.8)+"px Inter,system-ui,sans-serif";
      ctx.fillText(tr("Anote o desplacamento (GT) para obter a IoU real de cada contorno."),pad,y,S-2*pad);y+=fs*1.9;
    }
  }
  const cols=[tr("Região"),tr("Área motor"),tr("Área cheia"),"R","|∇u|",tr("Platô")],xs=[0,.16,.38,.6,.72,.86].map(f=>pad+f*(S-2*pad));
  ctx.fillStyle="#9fc9c4";ctx.font="700 "+Math.round(fs*.85)+"px Inter,system-ui,sans-serif";cols.forEach((t,i)=>ctx.fillText(t,xs[i],y));
  y+=fs*.6;ctx.strokeStyle="rgba(255,255,255,.25)";ctx.beginPath();ctx.moveTo(pad,y);ctx.lineTo(S-pad,y);ctx.stroke();y+=fs*1.3;
  ctx.font=Math.round(fs*.9)+"px Inter,system-ui,monospace";
  const rows=F.regions.slice(0,Q?(Q.mode==="gt"?5:6):9);
  if(!rows.length){ctx.fillStyle="#e7f0f2";ctx.fillText(tr("Nenhuma região de dano dentro da seleção."),pad,y)}
  rows.forEach((r,i)=>{
    const good=r.R>=.7;ctx.fillStyle=good?"#e7f0f2":"#ffd27a";
    const cells=["#"+(i+1)+" ("+r.center[0]+","+r.center[1]+")",String(r.area_engine_px),String(r.area_local_px),num(r.R),num(r.grad_median,3),Math.round(r.plateau_frac*100)+" %"];
    cells.forEach((t,j)=>ctx.fillText(t,xs[j],y,j===0?xs[1]-xs[0]-6:undefined));y+=fs*1.55;
  });
  y=S-pad-fs*7.4;ctx.fillStyle="rgba(231,240,242,.72)";ctx.font=Math.round(fs*.82)+"px Inter,system-ui,sans-serif";
  for(const line of [tr("R ≥ 0,70: o potencial cai de forma ordenada do dano para o saudável."),tr("R baixo ou |∇u| fraco: transição difusa; o limiar escolhe a borda."),tr("Platô: fração da região sem gradiente (halo sem evidência)."),tr("Área motor: escala do motor · Área cheia: walker refeito na seleção.")]){ctx.fillText(line,pad,y,S-2*pad);y+=fs*1.4}
  return compose(tr("Coerência por região"),c,S);
}

export function figurePanel(figs,S=FIELD_FIGURE_SIZE){
  const c=surface(2*S,2*S),ctx=c.getContext("2d");figs.forEach((f,i)=>ctx.drawImage(f,(i%2)*S,Math.floor(i/2)*S,S,S));return c;
}
