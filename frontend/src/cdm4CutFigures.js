// Figuras do estudo "Corte de nível" (binarização × potencial do walker), todas com 1200 × 800 px,
// fundo claro de publicação e faixa inferior com a interpretação anotada (gerada dos números).
import{tr,getLang}from"./i18n.js";
import{interpretMaps,interpretProfile,interpretCurves,widthText,measureRows}from"./cdm4CutAnalysis.js";
import{surface}from"./svgCanvas.js";

export const CUT_FIG_W=1200,CUT_FIG_H=800;
const LOC={pt:"pt-BR",en:"en-US",es:"es-ES",fr:"fr-FR"};
export const fmt=(v,n=1)=>v==null||!isFinite(v)?"—":Number(v).toLocaleString(LOC[getLang()]||"pt-BR",{minimumFractionDigits:n,maximumFractionDigits:n});
const trf=(t,vars={})=>tr(t).replace(/\{(\w+)\}/g,(_,k)=>{const v=vars[k];return typeof v==="string"?tr(v):String(v)});
const C={ink:"#1d2a33",muted:"#5d6d76",grid:"rgba(29,42,51,.10)",bin:"#d62020",walker:"#e07800",gt:"#00b8c8",terrain:"#b9a888",terrainLine:"#5b4a2f",poleless:"#7a3fd1",cut:"#f2c200"};
const VIRIDIS=[[68,1,84],[72,40,120],[62,74,137],[49,104,142],[38,130,142],[31,158,137],[53,183,121],[110,206,88],[181,222,43],[253,231,37]];
const vir=t=>{t=Math.min(1,Math.max(0,t))*(VIRIDIS.length-1);const i=Math.min(VIRIDIS.length-2,Math.floor(t)),f=t-i,a=VIRIDIS[i],b=VIRIDIS[i+1];return[a[0]+(b[0]-a[0])*f,a[1]+(b[1]-a[1])*f,a[2]+(b[2]-a[2])*f]};
export const cutLabel=i=>String.fromCharCode(65+(i%26))+(i>=26?Math.floor(i/26):"");

function canvas(w,h){if(typeof OffscreenCanvas!=="undefined"&&typeof document==="undefined")return new OffscreenCanvas(w,h);const c=document.createElement("canvas");c.width=w;c.height=h;return c}
const font=(px,wt=400)=>`${wt} ${px}px Inter,system-ui,sans-serif`;
function frame(title,sub){
  const c=surface(CUT_FIG_W,CUT_FIG_H),x=c.getContext("2d");x.fillStyle="#fff";x.fillRect(0,0,CUT_FIG_W,CUT_FIG_H);
  x.fillStyle=C.ink;x.font=font(22,700);x.textBaseline="alphabetic";x.fillText(tr(title),32,42);
  if(sub){x.fillStyle=C.muted;x.font=font(14);x.fillText(sub,32,66,CUT_FIG_W-64)}
  return{c,x};
}
function wrap(x,text,maxW){const words=text.split(" "),lines=[];let cur="";for(const w of words){const t=cur?cur+" "+w:w;if(x.measureText(t).width>maxW&&cur){lines.push(cur);cur=w}else cur=t}if(cur)lines.push(cur);return lines}
// faixa de interpretação: altura calculada pelo texto; devolve o topo da faixa
function notesBand(x,items){
  x.font=font(15);const maxW=CUT_FIG_W-64-26,lines=[];
  for(const[t,v]of items){const ls=wrap(x,trf(t,v),maxW);ls.forEach((l,i)=>lines.push([l,i===0]))}
  const lh=21,hgt=lines.length*lh+44,y0=CUT_FIG_H-hgt-16;
  x.fillStyle="#f3f6f7";x.fillRect(24,y0,CUT_FIG_W-48,hgt);x.fillStyle=C.walker;x.fillRect(24,y0,4,hgt);
  x.fillStyle=C.ink;x.font=font(13,700);x.fillText(tr("Interpretação"),40,y0+22);
  x.font=font(15);let y=y0+44;for(const[l,first]of lines){x.fillStyle=first?C.ink:C.ink;if(first)x.fillText("•",40,y);x.fillText(l,56,y);y+=lh}
  return y0;
}
// marcas "redondas" dentro do intervalo + as duas pontas (o eixo sempre termina com um valor)
export function axisTicks(a,b,count=5){
  if(!(b>a))return[a,b];const raw=(b-a)/count,p=10**Math.floor(Math.log10(raw)),st=[1,2,2.5,5,10].map(k=>k*p).find(v=>v>=raw)||raw;
  const t=[a];for(let v=Math.ceil(a/st)*st;v<b;v+=st){if(v-a>st*.4&&b-v>st*.4)t.push(+v.toFixed(10))}t.push(b);return t;
}
export const niceUp=v=>{if(!(v>0))return 1;const p=10**Math.floor(Math.log10(v));return([1,1.5,2,2.5,3,4,5,6,8,10].find(m=>m*p>=v*(1-1e-9))||10)*p};
export function decadeRange(lo,hi){return[10**Math.floor(Math.log10(Math.max(lo,1e-9))+1e-9),10**Math.ceil(Math.log10(Math.max(hi,1e-9))-1e-9)]}
function chart(x,X,Y,W,H,o){
  const{x0,x1,y0,y1,log}=o,ly=v=>Math.log10(Math.max(v,y0));
  const px=v=>X+(v-x0)/(x1-x0)*W,py=v=>log?Y+H-(ly(v)-ly(y0))/(ly(y1)-ly(y0))*H:Y+H-(v-y0)/(y1-y0)*H;
  x.save();x.strokeStyle=C.grid;x.lineWidth=1;x.fillStyle=C.muted;x.font=font(12);x.textAlign="right";x.textBaseline="middle";
  const yt=o.yticks||(log?(()=>{const r=[];for(let v=y0;v<=y1*1.0001;v*=10)r.push(v);return r})():axisTicks(y0,y1,4));
  const lo_=Math.min(y0,y1),hi_=Math.max(y0,y1),eps=log?hi_*1e-9:(hi_-lo_)*1e-9;
  for(const v of yt){if(v<lo_-eps||v>hi_+eps)continue;const yy=py(v);x.beginPath();x.moveTo(X,yy);x.lineTo(X+W,yy);x.stroke();x.fillText(o.yfmt?o.yfmt(v):fmt(v,1),X-6,yy)}
  x.textAlign="center";x.textBaseline="top";const xt=o.xticks||axisTicks(x0,x1,o.xcount||5);
  for(const v of xt){const xx=px(v);x.beginPath();x.moveTo(xx,Y);x.lineTo(xx,Y+H);x.stroke();x.fillText(o.xfmt?o.xfmt(v):fmt(v,o.xdec??1),xx,Y+H+5)}
  x.strokeStyle="rgba(29,42,51,.45)";x.strokeRect(X,Y,W,H);
  x.fillStyle=C.ink;x.font=font(13);if(o.xlabel)x.fillText(tr(o.xlabel),X+W/2,Y+H+22);
  if(o.ylabel){x.save();x.translate(X-48,Y+H/2);x.rotate(-Math.PI/2);x.textBaseline="bottom";x.fillText(tr(o.ylabel),0,0);x.restore()}
  if(o.title){x.textAlign="left";x.textBaseline="alphabetic";x.font=font(14,600);x.fillText(o.title,X,Y-8,W)}
  x.restore();return{px,py,X,Y,W,H};
}

// ---------- mapas ----------
const BASES=new WeakMap();
function baseCanvas(img){if(BASES.has(img))return BASES.get(img);const c=canvas(img.width,img.height);c.getContext("2d").putImageData(img,0,0);c.__photo=true;BASES.set(img,c);return c}
function panelRaster(B,pw,ph,fn){
  const c=canvas(pw,ph),x=c.getContext("2d"),id=x.createImageData(pw,ph),{w,h}=B;
  for(let j=0;j<ph;j++){const yy=Math.min(h-1,Math.floor((j+.5)/ph*h));for(let i=0;i<pw;i++){const p=yy*w+Math.min(w-1,Math.floor((i+.5)/pw*w)),o=4*(j*pw+i),r=fn(p);if(r){id.data[o]=r[0];id.data[o+1]=r[1];id.data[o+2]=r[2];id.data[o+3]=r[3]??255}}}
  x.putImageData(id,0,0);return c;
}
function gridSample(B,A,pw,ph){const{w,h}=B,g=new Float32Array(pw*ph);for(let j=0;j<ph;j++){const yy=Math.min(h-1,Math.floor((j+.5)/ph*h));for(let i=0;i<pw;i++)g[j*pw+i]=A[yy*w+Math.min(w-1,Math.floor((i+.5)/pw*w))]}return g}
// isolinhas por marching squares na grade do painel
function isolines(x,g,pw,ph,lv,ox,oy){
  x.beginPath();
  for(let j=0;j<ph-1;j++)for(let i=0;i<pw-1;i++){
    const a=g[j*pw+i],b=g[j*pw+i+1],c=g[(j+1)*pw+i+1],d=g[(j+1)*pw+i];
    const k=(a>lv?8:0)|(b>lv?4:0)|(c>lv?2:0)|(d>lv?1:0);if(k===0||k===15)continue;
    const T=[i+(lv-a)/(b-a),j],R=[i+1,j+(lv-b)/(c-b)],Bt=[i+(lv-d)/(c-d),j+1],L=[i,j+(lv-a)/(d-a)];
    const segs={1:[[L,Bt]],2:[[Bt,R]],3:[[L,R]],4:[[T,R]],5:[[L,T],[Bt,R]],6:[[T,Bt]],7:[[L,T]],8:[[L,T]],9:[[T,Bt]],10:[[T,R],[L,Bt]],11:[[T,R]],12:[[L,R]],13:[[Bt,R]],14:[[L,Bt]]}[k];
    for(const[p,q]of segs){x.moveTo(ox+p[0]+.5,oy+p[1]+.5);x.lineTo(ox+q[0]+.5,oy+q[1]+.5)}
  }
  x.stroke();
}
function edgeOverlay(x,B,mask,pw,ph,ox,oy,color){
  const g=gridSample(B,mask,pw,ph);x.fillStyle=color;
  for(let j=1;j<ph-1;j++)for(let i=1;i<pw-1;i++){const p=j*pw+i;if(g[p]&&!(g[p-1]&&g[p+1]&&g[p-pw]&&g[p+pw]))x.fillRect(ox+i,oy+j,1.4,1.4)}
}
function drawCuts(x,B,cuts,ox,oy,pw,ph){
  const k=pw/B.w;x.save();x.lineWidth=2;
  cuts.forEach((c,i)=>{const a=[ox+c.x1*k,oy+c.y1*k],b=[ox+c.x2*k,oy+c.y2*k];
    x.strokeStyle="rgba(0,0,0,.55)";x.setLineDash([]);x.lineWidth=3.5;x.beginPath();x.moveTo(...a);x.lineTo(...b);x.stroke();
    x.strokeStyle=C.cut;x.lineWidth=2;x.setLineDash([7,5]);x.beginPath();x.moveTo(...a);x.lineTo(...b);x.stroke();x.setLineDash([]);
    x.font=font(15,800);x.lineWidth=3;x.strokeStyle="rgba(0,0,0,.7)";x.strokeText(cutLabel(i),a[0]+4,a[1]-6);x.fillStyle=C.cut;x.fillText(cutLabel(i),a[0]+4,a[1]-6)});
  x.restore();
}
export function figureMaps(B,img,cuts){
  const g=B.global,{c,x}=frame("Binarização × potencial do walker",`${B.w} × ${B.h} px · ${tr("Otsu")} ${fmt(B.otsu,2)} · τ = ${fmt(B.tau,1)} · ${tr("níveis")} ${B.levels.map(v=>fmt(v,1)).join(" · ")}`);
  const notes=interpretMaps(B,fmt),top=96;
  // mede a faixa antes, para dimensionar os painéis
  const probe=canvas(10,10).getContext("2d");probe.font=font(15);let nl=0;for(const[t,v]of notes)nl+=wrap(probe,trf(t,v),CUT_FIG_W-90).length;
  const bandTop=CUT_FIG_H-(nl*21+44)-16,bodyH=bandTop-top-84,gap=18,maxPW=(CUT_FIG_W-64-2*gap)/3;
  const k=Math.min(maxPW/B.w,bodyH/B.h),pw=Math.max(40,Math.round(B.w*k)),ph=Math.max(40,Math.round(B.h*k)),tot=3*pw+2*gap,X0=Math.round((CUT_FIG_W-tot)/2),Y0=top+26;
  const base=baseCanvas(img),pct=v=>fmt(v*100,1)+" %";
  const titles=[`(a) ${tr("Binarização")} · ${tr("escuridão")} > ${fmt(B.otsu,2)}`,`(b) ${tr("Potencial u e curvas de nível")}`,`(c) ${tr("Corte do potencial")} u > ${fmt(B.tau,1)}`];
  const subs=[B.gt?`IoU ${pct(g.bin.iou)}`:`${tr("área")} ${pct(g.bin.area)}`,"",B.gt?`IoU ${pct(g.walker.iou)} · ${tr("ciano = GT")}`:`${tr("área")} ${pct(g.walker.area)}`];
  for(let p=0;p<3;p++){
    const ox=X0+p*(pw+gap),oy=Y0;x.imageSmoothingEnabled=true;x.imageSmoothingQuality="high";
    if(p!==1)x.drawImage(base,ox,oy,pw,ph);
    if(p===0)x.drawImage(panelRaster(B,pw,ph,i=>B.dark[i]>B.otsu?[214,32,32,140]:null),ox,oy);
    if(p===1){x.drawImage(panelRaster(B,pw,ph,i=>vir(B.u[i])),ox,oy);const gs=gridSample(B,B.u,pw,ph);x.lineWidth=1;
      for(const lv of [.1,.3,.5,.7,.9]){x.strokeStyle=B.levels.some(l=>Math.abs(l-lv)<1e-6)?"#fff":"rgba(255,255,255,.55)";x.lineWidth=B.levels.some(l=>Math.abs(l-lv)<1e-6)?1.6:.8;isolines(x,gs,pw,ph,lv,ox,oy)}
      for(const lv of B.levels)if(![.1,.3,.5,.7,.9].some(l=>Math.abs(l-lv)<1e-6)){x.strokeStyle="#fff";x.lineWidth=1.6;isolines(x,gs,pw,ph,lv,ox,oy)}}
    if(p===2){x.drawImage(panelRaster(B,pw,ph,i=>B.u[i]>B.tau?[224,120,0,140]:null),ox,oy);if(B.gt)edgeOverlay(x,B,B.gt,pw,ph,ox,oy,C.gt)}
    drawCuts(x,B,cuts,ox,oy,pw,ph);
    x.strokeStyle="rgba(29,42,51,.35)";x.strokeRect(ox,oy,pw,ph);
    x.fillStyle=C.ink;x.font=font(13,600);x.textAlign="center";x.fillText(titles[p],ox+pw/2,oy-22,pw+gap);x.font=font(12);x.fillStyle=C.muted;x.fillText(subs[p],ox+pw/2,oy-7,pw+gap);x.textAlign="left";
    if(p===1){const by=oy+ph+10,bw=pw,gr=x.createLinearGradient(ox,0,ox+bw,0);for(let i=0;i<=20;i++){const[r,gg,b]=vir(i/20);gr.addColorStop(i/20,`rgb(${r|0},${gg|0},${b|0})`)}x.fillStyle=gr;x.fillRect(ox,by,bw,10);
      x.fillStyle=C.muted;x.font=font(11);x.textAlign="left";x.fillText("0",ox,by+23);x.textAlign="right";x.fillText("1",ox+bw,by+23);x.textAlign="center";x.fillText(tr("u = P(chegar primeiro ao polo de dano)"),ox+bw/2,by+23,bw-30);x.textAlign="left"}
  }
  notesBand(x,notes);return c;
}

// ---------- perfil de um corte ----------
function terrain(x,ch,s,v,cut,color,gt,extra=[],marks=[]){
  const{px,py}=ch,n=s.length;
  if(gt){x.fillStyle="rgba(0,184,200,.14)";let a=-1;for(let i=0;i<=n;i++){const on=i<n&&gt[i];if(on&&a<0)a=i;if(!on&&a>=0){x.fillRect(px(s[a]),ch.Y,px(s[i-1])-px(s[a]),ch.H);a=-1}}}
  for(const m of marks){x.fillStyle="rgba(122,63,209,.13)";x.fillRect(px(s[m[0]]),ch.Y,Math.max(1,px(s[m[1]])-px(s[m[0]])),ch.H)}
  x.beginPath();x.moveTo(px(s[0]),py(0));for(let i=0;i<n;i++)x.lineTo(px(s[i]),py(v[i]));x.lineTo(px(s[n-1]),py(0));x.closePath();x.fillStyle="rgba(185,168,136,.55)";x.fill();
  x.save();x.beginPath();x.rect(ch.X,py(1),ch.W,py(cut)-py(1));x.clip();
  x.beginPath();x.moveTo(px(s[0]),py(cut));for(let i=0;i<n;i++)x.lineTo(px(s[i]),py(Math.max(cut,v[i])));x.lineTo(px(s[n-1]),py(cut));x.closePath();x.fillStyle=color;x.globalAlpha=.8;x.fill();x.restore();
  x.beginPath();for(let i=0;i<n;i++)i?x.lineTo(px(s[i]),py(v[i])):x.moveTo(px(s[i]),py(v[i]));x.strokeStyle=C.terrainLine;x.lineWidth=1.1;x.stroke();
  x.strokeStyle=color;x.lineWidth=1.8;x.beginPath();x.moveTo(ch.X,py(cut));x.lineTo(ch.X+ch.W,py(cut));x.stroke();
  for(const e of extra){x.setLineDash([3,4]);x.lineWidth=1.1;x.beginPath();x.moveTo(ch.X,py(e));x.lineTo(ch.X+ch.W,py(e));x.stroke();x.setLineDash([])}
}
function cutLabelBox(x,X,Y,text,color){x.font=font(12,700);const w=x.measureText(text).width+10;x.fillStyle="rgba(255,255,255,.88)";x.fillRect(X,Y-14,w,18);x.fillStyle=color;x.fillText(text,X+5,Y)}
function locator(x,img,B,cut,X,Y,S){
  const k=Math.min(S/B.w,S/B.h),w=B.w*k,h=B.h*k;x.drawImage(baseCanvas(img),X+S-w,Y,w,h);x.strokeStyle="rgba(29,42,51,.35)";x.strokeRect(X+S-w,Y,w,h);
  x.strokeStyle=C.cut;x.lineWidth=2.5;x.beginPath();x.moveTo(X+S-w+cut.x1*k,Y+cut.y1*k);x.lineTo(X+S-w+cut.x2*k,Y+cut.y2*k);x.stroke();
}
export function figureProfile(B,P,i,img){
  const N=P.notes,L=cutLabel(i),{c,x}=frame(`${tr("Perfil de corte")} ${L}`,`(${fmt(P.x1,0)}, ${fmt(P.y1,0)}) → (${fmt(P.x2,0)}, ${fmt(P.y2,0)}) · ${fmt(P.len,0)} px · ${tr("faixa ciano = GT · faixa violeta = escuro sem polo")}`);
  const notes=interpretProfile(P,fmt),probe=canvas(10,10).getContext("2d");probe.font=font(15);let nl=0;for(const[t,v]of notes)nl+=wrap(probe,trf(t,v),CUT_FIG_W-90).length;
  const bandTop=CUT_FIG_H-(nl*21+44)-16,X=96,W=CUT_FIG_W-X-40,top=104,avail=bandTop-top-58,hh=(avail-44)/2;
  locator(x,img,B,P,CUT_FIG_W-40-150,10,82);
  const xo={x0:0,x1:Math.round(P.len),y0:0,y1:1,xdec:0,xcount:6,yticks:[0,.25,.5,.75,1],yfmt:v=>fmt(v,2)};
  const c1=chart(x,X,top,W,hh,{...xo,ylabel:"escuridão",title:`${L} · ${tr("escuridão do pixel → binarização")}`});
  terrain(x,c1,P.s,P.dark,B.otsu,C.bin,P.gt,[],N.poleless);
  cutLabelBox(x,X+6,c1.py(B.otsu)-6,`${tr("corte Otsu")} ${fmt(B.otsu,2)} · ${N.binCross} ${tr("cruzamentos")}`,C.bin);
  const c2=chart(x,X,top+hh+44,W,hh,{...xo,ylabel:"u",xlabel:"distância ao longo do corte (px)",title:`${L} · ${tr("potencial do walker u")}`});
  terrain(x,c2,P.s,P.u,B.tau,C.walker,P.gt,B.levels.filter(l=>Math.abs(l-B.tau)>1e-6),N.poleless);
  cutLabelBox(x,X+6,c2.py(B.tau)-6,`τ = ${fmt(B.tau,1)} · ${N.uCross} ${tr("cruzamentos")}`,C.walker);
  for(const l of B.levels)if(Math.abs(l-B.tau)>1e-6){x.fillStyle=C.walker;x.font=font(11);x.fillText(`${tr("nível")} ${fmt(l,1)}`,X+W-60,c2.py(l)-4)}
  // cotas de largura: fronteiras em u = τ (traço cheio) e faixa entre os níveis (traço fino)
  N.regions.forEach((r,ri)=>{
    const a=c2.px(r.sL),b=c2.px(r.sR),y=c2.py(.9),txt="R"+(ri+1)+" · "+fmt(r.width,1)+" px"+(N.mmPerPx?" · "+fmt(r.width*N.mmPerPx,1)+" mm":"")+(r.open?" *":"");
    x.save();x.strokeStyle="#1d2a33";x.fillStyle="#1d2a33";x.lineWidth=1.4;
    for(const xx of[a,b]){x.setLineDash([3,3]);x.beginPath();x.moveTo(xx,c2.py(B.tau));x.lineTo(xx,y-8);x.stroke();x.setLineDash([])}
    x.beginPath();x.moveTo(a,y);x.lineTo(b,y);x.stroke();
    const head=(xx,d)=>{x.beginPath();x.moveTo(xx,y);x.lineTo(xx+d*7,y-4);x.lineTo(xx+d*7,y+4);x.closePath();x.fill()};if(b-a>16){head(a,1);head(b,-1)}
    x.font=font(12,700);x.textAlign="center";const tw=x.measureText(txt).width+10,cx=Math.min(c2.X+c2.W-tw/2,Math.max(c2.X+tw/2,(a+b)/2));
    x.fillStyle="rgba(255,255,255,.92)";x.fillRect(cx-tw/2,y-22,tw,16);x.fillStyle="#1d2a33";x.fillText(txt,cx,y-9);x.restore();
  });
  // marcas de deslocamento da borda entre níveis
  x.font=font(11,700);x.textAlign="center";
  for(const sft of N.shifts){const xx=c2.px(sft.at);x.fillStyle="#7a4a00";x.fillText(`${fmt(sft.px,1)} px`,Math.min(X+W-24,Math.max(X+24,xx+(sft.side==="in"?-22:22))),c2.py(.62))}
  x.textAlign="left";
  notesBand(x,notes);return c;
}

// ---------- curvas de corte ----------
export function figureCurves(B){
  const g=B.global,cv=g.curves,{c,x}=frame("Curva de corte: área e IoU × nível",`${tr("binarização")}: ${tr("escuridão")} > t · ${tr("walker")}: u > t`);
  const notes=interpretCurves(B,fmt),probe=canvas(10,10).getContext("2d");probe.font=font(15);let nl=0;for(const[t,v]of notes)nl+=wrap(probe,trf(t,v),CUT_FIG_W-90).length;
  const bandTop=CUT_FIG_H-(nl*21+44)-16,top=110,H=bandTop-top-64,Wc=(CUT_FIG_W-96-40-80)/2;
  const pf=v=>{const q=v*100;return fmt(q,q>=1?0:q>=.1?1:q>=.01?2:3)+" %"};
  const lo=decadeRange(Math.max(1e-5,Math.min(...cv.binArea,...cv.uArea,g.gtArea||1)),1)[0];
  const a=chart(x,96,top,Wc,H,{x0:0,x1:1,y0:lo,y1:1,log:true,yfmt:pf,xlabel:"nível de corte t",ylabel:"área acima do corte (log)",title:tr("Área acima do corte (curva hipsométrica)")});
  const line=(ch,ys,color,w=2.4)=>{x.beginPath();cv.t.forEach((t,i)=>{const v=ch.py(Math.max(ys[i],ch===a?lo:0));i?x.lineTo(ch.px(t),v):x.moveTo(ch.px(t),v)});x.strokeStyle=color;x.lineWidth=w;x.stroke()};
  line(a,cv.binArea,C.bin);line(a,cv.uArea,C.walker);
  if(B.gt){x.setLineDash([6,4]);x.strokeStyle=C.gt;x.lineWidth=1.5;x.beginPath();x.moveTo(a.X,a.py(g.gtArea));x.lineTo(a.X+a.W,a.py(g.gtArea));x.stroke();x.setLineDash([])}
  const vline=(ch,t,color)=>{x.setLineDash([2,4]);x.strokeStyle=color;x.lineWidth=1.2;x.beginPath();x.moveTo(ch.px(t),ch.Y);x.lineTo(ch.px(t),ch.Y+ch.H);x.stroke();x.setLineDash([])};
  vline(a,B.otsu,C.bin);vline(a,B.tau,C.walker);
  legend(x,a.X+a.W-210,a.Y+12,[[C.bin,tr("binarização")],[C.walker,tr("walker")],...(B.gt?[[C.gt,tr("área do GT"),true]]:[])]);
  const X2=96+Wc+80;
  if(B.gt){
    const b=chart(x,X2,top,Wc,H,{x0:0,x1:1,y0:0,y1:1,yticks:[0,.2,.4,.6,.8,1],yfmt:v=>fmt(v*100,0)+" %",xlabel:"nível de corte t",ylabel:"IoU com o GT",title:tr("Sensibilidade ao limiar: IoU × nível")});
    line(b,cv.binIoU,C.bin);line(b,cv.uIoU,C.walker);vline(b,B.otsu,C.bin);vline(b,B.tau,C.walker);
    x.fillStyle="rgba(224,120,0,.08)";x.fillRect(b.px(.3),b.Y,b.px(.7)-b.px(.3),b.H);
    legend(x,b.X+b.W-170,b.Y+12,[[C.bin,tr("binarização")],[C.walker,tr("walker")]]);
  }else{
    // densidade: fração da imagem por faixa de 0,02 de nível (pixels "em cima" de cada corte)
    const dens=ys=>ys.slice(0,-1).map((v,i)=>Math.max(1e-5,v-ys[i+1])); // a última faixa acumularia toda a cauda
    const db=dens(cv.binArea),du=dens(cv.uArea),[dlo,dhi]=decadeRange(Math.max(1e-5,Math.min(...db,...du)),Math.max(...db,...du));
    const b=chart(x,X2,top,Wc,H,{x0:0,x1:1,y0:dlo,y1:dhi,log:true,yfmt:pf,xlabel:"nível de corte t",ylabel:"fração da imagem por faixa de 0,02 (log)",title:tr("Densidade de pixels por nível")});
    const dl=(ys,color)=>{x.beginPath();cv.t.slice(0,-1).forEach((t,i)=>{const v=b.py(Math.max(ys[i],dlo));i?x.lineTo(b.px(t),v):x.moveTo(b.px(t),v)});x.strokeStyle=color;x.lineWidth=2.4;x.stroke()};
    dl(db,C.bin);dl(du,C.walker);vline(b,B.otsu,C.bin);vline(b,B.tau,C.walker);
    x.fillStyle=C.muted;x.font=font(12);x.fillText(tr("muitos pixels no nível do corte = borda instável"),b.X+8,b.Y+b.H-10,b.W-16);
    legend(x,b.X+b.W-170,b.Y+12,[[C.bin,tr("binarização")],[C.walker,tr("walker")]]);
  }
  notesBand(x,notes);return c;
}
function legend(x,X,Y,items){x.font=font(12);const h=items.length*18+10;x.fillStyle="rgba(255,255,255,.9)";x.fillRect(X,Y,200,h);
  items.forEach(([col,t,dash],i)=>{const y=Y+14+i*18;x.strokeStyle=col;x.lineWidth=2.4;if(dash)x.setLineDash([6,4]);x.beginPath();x.moveTo(X+8,y);x.lineTo(X+30,y);x.stroke();x.setLineDash([]);x.fillStyle=C.ink;x.fillText(t,X+38,y+4,155)})}

// painel com todas as figuras (grade de 2 colunas), para baixar de uma vez
export function figureSheet(list){
  const cols=2,rows=Math.ceil(list.length/cols),s=.5,w=CUT_FIG_W*s,h=CUT_FIG_H*s,c=surface(w*cols+12*(cols+1),h*rows+12*(rows+1)),x=c.getContext("2d");
  x.fillStyle="#e9eef0";x.fillRect(0,0,c.width,c.height);list.forEach((f,i)=>x.drawImage(f,12+(i%cols)*(w+12),12+Math.floor(i/cols)*(h+12),w,h));return c;
}

// tabela de medidas de todos os cortes (largura em τ, faixa entre os níveis, mm quando há escala)
export function figureMeasures(B,P,labelOf=cutLabel){
  const rows=measureRows(P,labelOf),mm=B.mmPerPx>0,{c,x}=frame("Medidas ao longo dos cortes",`u = ${fmt(B.tau,1)} · ${tr("faixa entre os níveis")} ${fmt(B.levels[0],1)} ${tr("e")} ${fmt(B.levels[B.levels.length-1],1)}`+(mm?` · ${fmt(B.mmPerPx,3)} mm/px`:` · ${tr("sem calibração de escala")}`));
  const notes=[["As fronteiras são os pontos em que o potencial cruza τ, interpolados entre pixels; a faixa é a menor e a maior largura entre os níveis escolhidos.",{}],
    ["Faixa estreita = encosta íngreme, medida firme; faixa larga = platô, onde a borda depende do limiar.",{}],
    ...(rows.some(r=>r.open)?[["* região truncada pela ponta do corte: prolongue a linha para medir.",{}]]:[]),
    ...(mm?[["Conversão em mm válida para foto de frente para a superfície; com perspectiva, a escala muda ao longo da imagem.",{}]]:[["Sem calibração de escala, as larguras ficam em pixels (informe mm/px nas configurações).",{}]])];
  const probe=canvas(10,10).getContext("2d");probe.font=font(15);let nl=0;for(const[t,v]of notes)nl+=wrap(probe,trf(t,v),CUT_FIG_W-90).length;
  const bandTop=CUT_FIG_H-(nl*21+44)-16,top=104,X=40,Wt=CUT_FIG_W-80;
  const cols=mm?[["Corte",.08],["Região",.08],["Largura (px)",.14],["Faixa (px)",.2],["Largura (mm)",.14],["Faixa (mm)",.2],["Início → fim (px)",.16]]:[["Corte",.1],["Região",.1],["Largura (px)",.2],["Faixa (px)",.25],["Início → fim (px)",.35]];
  const rh=26,maxRows=Math.max(1,Math.floor((bandTop-top-40)/rh)),shown=rows.slice(0,maxRows);
  x.fillStyle="#e9eff1";x.fillRect(X,top,Wt,rh);x.font=font(13,700);x.fillStyle="#1d2a33";x.textBaseline="middle";
  let cx=X;const colX=cols.map(([t,w])=>{const p=cx;cx+=w*Wt;return p});
  cols.forEach(([t],i)=>x.fillText(tr(t),colX[i]+10,top+rh/2,cols[i][1]*Wt-14));
  x.font=font(13);shown.forEach((r,i)=>{const y=top+rh*(i+1);if(i%2){x.fillStyle="#f6f8f9";x.fillRect(X,y,Wt,rh)}x.fillStyle="#1d2a33";
    const cells=[r.cut,r.region+(r.open?" *":""),fmt(r.width_px,1),fmt(r.min_px,1)+" – "+fmt(r.max_px,1),...(mm?[fmt(r.width_mm,1),fmt(r.min_mm,1)+" – "+fmt(r.max_mm,1)]:[]),`(${fmt(r.x1,0)}, ${fmt(r.y1,0)}) → (${fmt(r.x2,0)}, ${fmt(r.y2,0)})`];
    cells.forEach((t,k)=>x.fillText(t,colX[k]+10,y+rh/2,cols[k][1]*Wt-14))});
  if(!rows.length){x.fillStyle="#5d6d76";x.fillText(tr("Nenhuma região do walker cruza os cortes traçados."),X+10,top+rh*1.5)}
  if(rows.length>shown.length){x.fillStyle="#5d6d76";x.fillText(`+ ${rows.length-shown.length} ${tr("regiões no CSV")}`,X+10,top+rh*(shown.length+1)+rh/2)}
  x.strokeStyle="rgba(29,42,51,.25)";x.strokeRect(X,top,Wt,rh*(Math.max(1,shown.length)+1));x.textBaseline="alphabetic";
  // ponto (largura em τ) + barra (faixa entre os níveis), uma linha por região: compara a firmeza das medidas
  const cTop=top+rh*(shown.length+1)+56,cH=bandTop-cTop-48,dot=shown.slice(0,Math.max(0,Math.floor(cH/22)));
  if(dot.length&&cH>60){
    const val=r=>mm?[r.width_mm,r.min_mm,r.max_mm]:[r.width_px,r.min_px,r.max_px],vmax=Math.max(...dot.map(r=>val(r)[2]))*1.08||1;
    const ch=chart(x,180,cTop,CUT_FIG_W-180-60,cH,{x0:0,x1:vmax,y0:0,y1:dot.length,yticks:[],xlabel:mm?"largura (mm)":"largura (px)",xdec:0,title:tr("Largura em τ (ponto) e faixa entre os níveis (barra)")});
    const step=ch.H/dot.length;
    dot.forEach((r,i)=>{const[v,lo,hi]=val(r),y=ch.Y+step*(i+.5);
      x.fillStyle="#1d2a33";x.font=font(12,600);x.textAlign="right";x.textBaseline="middle";x.fillText(r.cut+" · "+r.region+(r.open?" *":""),ch.X-10,y);
      x.strokeStyle=C.walker;x.lineWidth=2.5;x.beginPath();x.moveTo(ch.px(lo),y);x.lineTo(ch.px(hi),y);x.stroke();
      for(const e of[lo,hi]){x.beginPath();x.moveTo(ch.px(e),y-6);x.lineTo(ch.px(e),y+6);x.stroke()}
      x.fillStyle=C.walker;x.beginPath();x.arc(ch.px(v),y,5,0,2*Math.PI);x.fill();
      x.fillStyle="#5d6d76";x.font=font(11);x.textAlign="left";x.fillText(fmt(hi-lo,1)+(mm?" mm":" px"),Math.min(ch.X+ch.W-50,ch.px(hi)+8),y)});
    x.textAlign="left";x.textBaseline="alphabetic";
  }
  notesBand(x,notes);return c;
}

// ---------- largura de fissura (perfil perpendicular) ----------
export const crackLabel=i=>"F"+(i+1);
export function interpretCrack(K,mm,f){
  const S=K.summary,o=[];if(!S||!S.valid)return[["Nenhum vale escuro com contraste suficiente ao longo do eixo: confira se a linha segue a fissura.",{}]];
  const u=v=>f(v,1)+" px"+(mm?" ("+f(v*mm,2)+" mm)":"");
  o.push(["Largura a meia profundidade (FWHM): mediana {med}, p10–p90 {p10}–{p90}, máxima {max}; {v} de {n} perfis válidos.",{med:u(S.median),p10:f(S.p10,1),p90:f(S.p90,1),max:u(S.max),v:S.valid,n:S.n}]);
  o.push(["Largura equivalente (área do vale ÷ profundidade): mediana {eq}; profundidade do vale {d} níveis de cinza.",{eq:u(S.eqMedian),d:f(S.depthMedian,0)}]);
  if(S.belowResolution)o.push(["Mediana abaixo de ~3 px: a fissura está no limite de resolução e o borramento da óptica alarga o vale. O valor é um teto (abertura real ≤ {max}); aproxime a câmera para medir.",{max:u(S.median)}]);
  else o.push(["Fissura resolvida (≥ 3 px): em teste com fissuras sintéticas de largura conhecida, o erro foi menor que 0,5 px.",{}]);
  if(!mm)o.push(["Sem calibração de escala, a largura fica em pixels (informe mm/px nas configurações).",{}]);
  return o;
}
export function figureCrack(K,i,img,mm=0){
  const S=K.summary||{},a=K.axis,{c,x}=frame(`${tr("Largura de fissura")} ${crackLabel(i)}`,`(${fmt(a.x1,0)}, ${fmt(a.y1,0)}) → (${fmt(a.x2,0)}, ${fmt(a.y2,0)}) · ${fmt(K.len,0)} px · ${tr("perfis a cada")} ${fmt(K.opts.step,0)} px · ±${fmt(K.opts.R,0)} px`+(mm?` · ${fmt(mm,3)} mm/px`:""));
  const notes=interpretCrack(K,mm,fmt),probe=canvas(10,10).getContext("2d");probe.font=font(15);let nl=0;for(const[t,v]of notes)nl+=wrap(probe,trf(t,v),CUT_FIG_W-90).length;
  const bandTop=CUT_FIG_H-(nl*21+44)-16,top=100,bodyH=bandTop-top-20;
  // recorte da foto em volta do eixo, com as bordas encontradas em cada perfil
  const pad=K.opts.R+12,bx0=Math.max(0,Math.min(a.x1,a.x2)-pad),by0=Math.max(0,Math.min(a.y1,a.y2)-pad),bx1=Math.min(img.width,Math.max(a.x1,a.x2)+pad),by1=Math.min(img.height,Math.max(a.y1,a.y2)+pad);
  const bw=bx1-bx0,bh=by1-by0,PW=380,k=Math.min(PW/bw,bodyH/bh),pw=bw*k,ph=bh*k,ox=32+(PW-pw)/2,oy=top+(bodyH-ph)/2;
  x.imageSmoothingEnabled=k<3;x.drawImage(baseCanvas(img),bx0,by0,bw,bh,ox,oy,pw,ph);x.imageSmoothingEnabled=true;
  const P=(X,Y)=>[ox+(X-bx0)*k,oy+(Y-by0)*k];
  x.strokeStyle="rgba(176,108,255,.9)";x.lineWidth=1.5;x.setLineDash([6,4]);x.beginPath();x.moveTo(...P(a.x1,a.y1));x.lineTo(...P(a.x2,a.y2));x.stroke();x.setLineDash([]);
  const val=K.stations.filter(s=>s.valid),every=Math.max(1,Math.round(val.length/40));
  val.forEach((s,j)=>{if(j%every)return;x.strokeStyle="rgba(242,194,0,.9)";x.lineWidth=1.2;x.beginPath();x.moveTo(...P(s.lx,s.ly));x.lineTo(...P(s.rx,s.ry));x.stroke();
    x.fillStyle="#00e0ff";for(const[q,r]of[[s.lx,s.ly],[s.rx,s.ry]]){const[u,v]=P(q,r);x.fillRect(u-1.5,v-1.5,3,3)}});
  x.strokeStyle="rgba(29,42,51,.35)";x.strokeRect(ox,oy,pw,ph);
  x.fillStyle=C.muted;x.font=font(11);x.fillText(tr("amarelo = largura em cada perfil · ciano = bordas a meia profundidade"),32,oy+ph+16,PW);
  // largura ao longo do eixo
  const X2=32+PW+90,W2=CUT_FIG_W-X2-40,h1=(bodyH-70)*.55,h2=(bodyH-70)*.45;
  if(val.length){
    const ymax=niceUp(Math.max(S.p90*1.6,S.max*1.05,4));
    const c1=chart(x,X2,top+10,W2,h1,{x0:0,x1:Math.round(K.len),y0:0,y1:ymax,xdec:0,xlabel:"distância ao longo do eixo (px)",ylabel:"FWHM (px)",yfmt:v=>fmt(v,1),title:tr("Largura ao longo da fissura")});
    x.fillStyle="rgba(176,108,255,.12)";x.fillRect(c1.X,c1.py(S.p90),c1.W,c1.py(S.p10)-c1.py(S.p90));
    if(K.opts.resolutionPx<ymax){x.setLineDash([5,4]);x.strokeStyle=C.bin;x.lineWidth=1.2;x.beginPath();x.moveTo(c1.X,c1.py(K.opts.resolutionPx));x.lineTo(c1.X+c1.W,c1.py(K.opts.resolutionPx));x.stroke();x.setLineDash([]);
      x.fillStyle=C.bin;x.font=font(11,600);x.textAlign="right";x.fillText(tr("limite de resolução ≈ 3 px"),c1.X+c1.W-6,c1.py(K.opts.resolutionPx)-4);x.textAlign="left"}
    x.strokeStyle="#7a3fd1";x.lineWidth=1.6;x.beginPath();let first=true;for(const s of K.stations){if(!s.valid){first=true;continue}const p=[c1.px(s.s),c1.py(Math.min(ymax,s.fwhm))];first?x.moveTo(...p):x.lineTo(...p);first=false}x.stroke();
    x.setLineDash([2,3]);x.strokeStyle="#1d2a33";x.beginPath();x.moveTo(c1.X,c1.py(S.median));x.lineTo(c1.X+c1.W,c1.py(S.median));x.stroke();x.setLineDash([]);
    x.fillStyle="#1d2a33";x.font=font(11,700);x.fillText(`${tr("mediana")} ${fmt(S.median,1)} px`+(mm?` · ${fmt(S.median*mm,2)} mm`:""),c1.X+6,c1.py(S.median)-5);
    // perfil médio alinhado no vale
    const pr=K.profile,mn=Math.min(...pr.I),c2=chart(x,X2,top+h1+70,W2,h2,{x0:-K.opts.R,x1:K.opts.R,y0:-niceUp(-mn*1.1),y1:niceUp(Math.max(10,-mn*.25)),xdec:0,xlabel:"deslocamento perpendicular ao eixo (px)",ylabel:"cinza − fundo",yfmt:v=>fmt(v,0),title:tr("Perfil médio alinhado no vale")});
    x.strokeStyle=C.terrainLine;x.lineWidth=1.8;x.beginPath();pr.d.forEach((d,j)=>{const p=[c2.px(d),c2.py(pr.I[j])];j?x.lineTo(...p):x.moveTo(...p)});x.stroke();
    const half=mn/2;x.setLineDash([4,3]);x.strokeStyle=C.walker;x.beginPath();x.moveTo(c2.X,c2.py(half));x.lineTo(c2.X+c2.W,c2.py(half));x.stroke();x.setLineDash([]);
    const l=c2.px(-S.median/2),r=c2.px(S.median/2);x.strokeStyle="#1d2a33";x.lineWidth=1.4;x.beginPath();x.moveTo(l,c2.py(half));x.lineTo(r,c2.py(half));x.stroke();
    x.fillStyle=C.walker;x.font=font(11,700);x.fillText(tr("meia profundidade"),c2.X+6,c2.py(half)-5);
  }
  notesBand(x,notes);return c;
}
export function crackCsv(K,mm){
  const h=["fissura","estacao","s_px","x_px","y_px","valido","fwhm_px","larg_equivalente_px","profundidade","fwhm_mm","mm_por_px"],n=v=>v==null?"":(+v).toFixed(2),rows=[h.join(";")];
  K.forEach((k,i)=>k.stations.forEach((s,j)=>rows.push([crackLabel(i),j+1,n(s.s),n(s.x),n(s.y),s.valid?"sim":"nao",s.valid?n(s.fwhm):"",s.valid?n(s.eq):"",n(s.depth),s.valid&&mm?n(s.fwhm*mm):"",mm||""].join(";"))));
  return rows.join("\n")+"\n";
}
