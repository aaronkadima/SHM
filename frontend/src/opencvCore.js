// Núcleo puro (sem DOM) do baseline OpenCV: usado pelo motor de imagem e pelo modo Live (Web Worker).
function maxFilterHorizontal(src,w,h,r){
  const out=new Uint8Array(src.length);
  for(let y=0;y<h;y++){const row=y*w;for(let x=0;x<w;x++){let m=0;const a=Math.max(0,x-r),b=Math.min(w-1,x+r);for(let xx=a;xx<=b;xx++){const v=src[row+xx];if(v>m)m=v}out[row+x]=m}}
  return out;
}
function maxFilterVertical(src,w,h,r){
  const out=new Uint8Array(src.length);
  for(let y=0;y<h;y++){const a=Math.max(0,y-r),b=Math.min(h-1,y+r);for(let x=0;x<w;x++){let m=0;for(let yy=a;yy<=b;yy++){const v=src[yy*w+x];if(v>m)m=v}out[y*w+x]=m}}
  return out;
}
function minFilterHorizontal(src,w,h,r){
  const out=new Uint8Array(src.length);
  for(let y=0;y<h;y++){const row=y*w;for(let x=0;x<w;x++){let m=255;const a=Math.max(0,x-r),b=Math.min(w-1,x+r);for(let xx=a;xx<=b;xx++){const v=src[row+xx];if(v<m)m=v}out[row+x]=m}}
  return out;
}
function minFilterVertical(src,w,h,r){
  const out=new Uint8Array(src.length);
  for(let y=0;y<h;y++){const a=Math.max(0,y-r),b=Math.min(h-1,y+r);for(let x=0;x<w;x++){let m=255;for(let yy=a;yy<=b;yy++){const v=src[yy*w+x];if(v<m)m=v}out[y*w+x]=m}}
  return out;
}
function gaussian3(src,w,h){
  const out=new Uint8Array(src.length),k=[1,2,1];
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    let s=0,ws=0;
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
      const yy=Math.max(0,Math.min(h-1,y+dy)),xx=Math.max(0,Math.min(w-1,x+dx));
      const ww=k[dy+1]*k[dx+1];s+=src[yy*w+xx]*ww;ws+=ww;
    }
    out[y*w+x]=Math.round(s/ws);
  }
  return out;
}
export function otsu(src){
  const hist=new Uint32Array(256);for(const v of src)hist[v]++;
  const total=src.length;let sum=0;for(let i=0;i<256;i++)sum+=i*hist[i];
  let sumB=0,wB=0,maxVar=-1,threshold=0;
  for(let t=0;t<256;t++){
    wB+=hist[t];if(!wB)continue;const wF=total-wB;if(!wF)break;
    sumB+=t*hist[t];const mB=sumB/wB,mF=(sum-sumB)/wF;
    const between=wB*wF*(mB-mF)*(mB-mF);
    if(between>maxVar){maxVar=between;threshold=t}
  }
  return threshold;
}
function binaryOpen2(mask,w,h){
  const eroded=new Uint8Array(mask.length);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    let ok=1;
    for(let dy=0;dy<=1&&ok;dy++)for(let dx=0;dx<=1;dx++){
      const yy=Math.min(h-1,y+dy),xx=Math.min(w-1,x+dx);
      if(!mask[yy*w+xx]){ok=0;break}
    }
    eroded[y*w+x]=ok;
  }
  const out=new Uint8Array(mask.length);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    let on=0;
    for(let dy=-1;dy<=0&&!on;dy++)for(let dx=-1;dx<=0;dx++){
      const yy=Math.max(0,y+dy),xx=Math.max(0,x+dx);
      if(eroded[yy*w+xx]){on=1;break}
    }
    out[y*w+x]=on;
  }
  return out;
}
export function components(mask,w,h,minArea,maxItems=120){
  const seen=new Uint8Array(mask.length),queue=new Uint32Array(mask.length),found=[];
  const dirs=[-1,1,-w,w,-w-1,-w+1,w-1,w+1];
  for(let i=0;i<mask.length;i++){
    if(!mask[i]||seen[i])continue;
    let head=0,tail=0;queue[tail++]=i;seen[i]=1;let area=0,minX=w,minY=h,maxX=0,maxY=0;
    while(head<tail){
      const p=queue[head++],y=Math.floor(p/w),x=p-y*w;area++;
      if(x<minX)minX=x;if(x>maxX)maxX=x;if(y<minY)minY=y;if(y>maxY)maxY=y;
      for(const d of dirs){
        const q=p+d;if(q<0||q>=mask.length||seen[q]||!mask[q])continue;
        const qy=Math.floor(q/w),qx=q-qy*w;if(Math.abs(qx-x)>1||Math.abs(qy-y)>1)continue;
        seen[q]=1;queue[tail++]=q;
      }
    }
    if(area>=minArea)found.push({area,box:[minX,minY,maxX+1,maxY+1]});
  }
  return found.sort((a,b)=>b.area-a.area).slice(0,maxItems);
}

export function grayFromRgba(rgba,n){
  const gray=new Uint8Array(n);
  for(let i=0,j=0;i<n;i++,j+=4)gray[i]=Math.round(.299*rgba[j]+.587*rgba[j+1]+.114*rgba[j+2]);
  return gray;
}
// Aproxima cv2.MORPH_BLACKHAT (kernel 2r+1) + blur 3x3 + Otsu + abertura 2x2.
export function opencvCrackCore(rgba,w,h,{radius=7,minAreaRatio=.00002,maxItems=120}={}){
  const n=w*h,gray=grayFromRgba(rgba,n);
  const dilated=maxFilterVertical(maxFilterHorizontal(gray,w,h,radius),w,h,radius);
  const closing=minFilterVertical(minFilterHorizontal(dilated,w,h,radius),w,h,radius);
  const blackhat=new Uint8Array(n);for(let i=0;i<n;i++)blackhat[i]=Math.max(0,closing[i]-gray[i]);
  const blurred=gaussian3(blackhat,w,h),threshold=otsu(blurred);
  const rawMask=new Uint8Array(n);for(let i=0;i<n;i++)rawMask[i]=blurred[i]>threshold?1:0;
  const mask=binaryOpen2(rawMask,w,h);
  let maskArea=0;for(const v of mask)maskArea+=v;
  const minArea=Math.max(8,Math.floor(n*minAreaRatio)),comps=components(mask,w,h,minArea,maxItems);
  return{mask,comps,threshold,maskArea};
}
