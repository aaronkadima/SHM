// Correção de imagem antes da análise (sem DOM). Todas as operações são determinísticas e
// registradas nos metadados, para que a análise seja rastreável (imagem original × corrigida).

export const NEUTRAL_CORRECTION={exposure:0,contrast:0,sCurve:0,gamma:1,saturation:0,whiteBalance:false,sharpen:0,denoise:0,rotate:0};
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

export function isNeutralCorrection(p={}){
  const q={...NEUTRAL_CORRECTION,...p};
  return q.exposure===0&&q.contrast===0&&q.sCurve===0&&q.gamma===1&&q.saturation===0&&!q.whiteBalance&&q.sharpen===0&&q.denoise===0&&!(q.rotate%360);
}

// Curva tonal composta (exposição → contraste → curva S → gama), normalizada 0..1.
export function toneCurve(p={}){
  const q={...NEUTRAL_CORRECTION,...p},gain=Math.pow(2,q.exposure),c=1+q.contrast/100,s=q.sCurve/100;
  return x=>{
    let v=x*gain;
    v=(v-.5)*c+.5;
    v=clamp(v,0,1);
    if(s>0){
      // Sigmoide normalizada (curva em S) misturada à identidade conforme a intensidade.
      const k=2+10*s,sig=t=>1/(1+Math.exp(-k*(t-.5))),lo=sig(0),hi=sig(1);
      v=(1-s)*v+s*(sig(v)-lo)/(hi-lo);
    }
    return Math.pow(clamp(v,0,1),1/Math.max(.1,q.gamma));
  };
}
export function toneLut(p){const f=toneCurve(p),lut=new Uint8ClampedArray(256);for(let i=0;i<256;i++)lut[i]=Math.round(255*f(i/255));return lut}

function rotate(imageData,deg){
  const turns=((Math.round(deg/90)%4)+4)%4;if(!turns)return imageData;
  const{width:w,height:h,data}=imageData,W=turns%2?h:w,H=turns%2?w:h,out=new Uint8ClampedArray(W*H*4);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    let nx,ny;
    if(turns===1){nx=h-1-y;ny=x}else if(turns===2){nx=w-1-x;ny=h-1-y}else{nx=y;ny=w-1-x}
    const s=(y*w+x)*4,d=(ny*W+nx)*4;out[d]=data[s];out[d+1]=data[s+1];out[d+2]=data[s+2];out[d+3]=data[s+3];
  }
  return{width:W,height:H,data:out};
}
function box3(src,w,h){
  const out=new Uint8ClampedArray(src.length);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++)for(let c=0;c<3;c++){
    let s=0,n=0;
    for(let dy=-1;dy<=1;dy++){const yy=y+dy;if(yy<0||yy>=h)continue;for(let dx=-1;dx<=1;dx++){const xx=x+dx;if(xx<0||xx>=w)continue;s+=src[(yy*w+xx)*4+c];n++}}
    out[(y*w+x)*4+c]=s/n;
  }
  for(let i=3;i<src.length;i+=4)out[i]=src[i];
  return out;
}

export function applyCorrection(imageData,p={}){
  const q={...NEUTRAL_CORRECTION,...p};
  let img={width:imageData.width,height:imageData.height,data:new Uint8ClampedArray(imageData.data)};
  const{width:w,height:h}=img,n=w*h;let d=img.data;
  if(q.whiteBalance){
    let r=0,g=0,b=0;for(let j=0;j<d.length;j+=4){r+=d[j];g+=d[j+1];b+=d[j+2]}
    const avg=(r+g+b)/3,gr=avg/Math.max(1,r),gg=avg/Math.max(1,g),gb=avg/Math.max(1,b);
    for(let j=0;j<d.length;j+=4){d[j]=d[j]*gr;d[j+1]=d[j+1]*gg;d[j+2]=d[j+2]*gb}
  }
  if(q.denoise>0){const blurred=box3(d,w,h),a=clamp(q.denoise/100,0,1);for(let j=0;j<d.length;j++)if((j&3)!==3)d[j]=d[j]*(1-a)+blurred[j]*a}
  if(!(q.exposure===0&&q.contrast===0&&q.sCurve===0&&q.gamma===1)){const lut=toneLut(q);for(let j=0;j<d.length;j++)if((j&3)!==3)d[j]=lut[d[j]]}
  if(q.saturation!==0){
    const s=1+q.saturation/100;
    for(let j=0;j<d.length;j+=4){const L=.299*d[j]+.587*d[j+1]+.114*d[j+2];d[j]=L+(d[j]-L)*s;d[j+1]=L+(d[j+1]-L)*s;d[j+2]=L+(d[j+2]-L)*s}
  }
  if(q.sharpen>0){const blurred=box3(d,w,h),a=1.6*clamp(q.sharpen/100,0,1);for(let j=0;j<d.length;j++)if((j&3)!==3)d[j]=d[j]+a*(d[j]-blurred[j])}
  img.data=d;
  return rotate(img,q.rotate);
}

export function describeCorrection(p={}){
  const q={...NEUTRAL_CORRECTION,...p},parts=[];
  if(q.exposure)parts.push("exposição "+(q.exposure>0?"+":"")+q.exposure.toFixed(2)+" EV");
  if(q.contrast)parts.push("contraste "+(q.contrast>0?"+":"")+q.contrast);
  if(q.sCurve)parts.push("curva S "+q.sCurve);
  if(q.gamma!==1)parts.push("gama "+q.gamma.toFixed(2));
  if(q.saturation)parts.push("saturação "+(q.saturation>0?"+":"")+q.saturation);
  if(q.whiteBalance)parts.push("balanço de branco automático");
  if(q.denoise)parts.push("redução de ruído "+q.denoise);
  if(q.sharpen)parts.push("nitidez "+q.sharpen);
  if(q.rotate%360)parts.push("rotação "+(q.rotate%360)+"°");
  return parts.join(" · ")||"sem correção";
}
