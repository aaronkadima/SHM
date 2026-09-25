function elevationColors(positions){
  const count=(positions?.length||0)/3;if(!count)return null;
  let min=Infinity,max=-Infinity;
  for(let i=2;i<positions.length;i+=3){const z=positions[i];if(z<min)min=z;if(z>max)max=z}
  const span=Math.max(max-min,1e-9),out=new Float32Array(count*3);
  for(let i=0;i<count;i++){
    const t=Math.max(0,Math.min(1,(positions[i*3+2]-min)/span));
    out[i*3]=.12+.78*t;
    out[i*3+1]=.35+.48*(1-Math.abs(t-.5)*2);
    out[i*3+2]=.82-.62*t;
  }
  return out;
}

export function registeredPointColors(parsed,registration,pixels){
  const pose=registration?.registration||registration;
  if(!pose?.camera_matrix||!pose?.rotation_matrix||!pose?.translation_vector)return null;
  const k=pose.camera_matrix,r=pose.rotation_matrix,t=pose.translation_vector,d=pose.distortion||[];
  const fx=Number(k[0][0]),fy=Number(k[1][1]),cx=Number(k[0][2]),cy=Number(k[1][2]);
  const k1=Number(d[0]||0),k2=Number(d[1]||0),p1=Number(d[2]||0),p2=Number(d[3]||0),k3=Number(d[4]||0);
  if(![fx,fy,cx,cy].every(Number.isFinite))return null;
  const center=parsed.bounds?.center||[0,0,0],fallback=elevationColors(parsed.positions);
  const count=parsed.positions.length/3,out=new Float32Array(count*3);
  let colored=0;
  for(let i=0;i<count;i++){
    const X=parsed.positions[i*3]+center[0],Y=parsed.positions[i*3+1]+center[1],Z=parsed.positions[i*3+2]+center[2];
    const xc=Number(r[0][0])*X+Number(r[0][1])*Y+Number(r[0][2])*Z+Number(t[0]);
    const yc=Number(r[1][0])*X+Number(r[1][1])*Y+Number(r[1][2])*Z+Number(t[1]);
    const zc=Number(r[2][0])*X+Number(r[2][1])*Y+Number(r[2][2])*Z+Number(t[2]);
    let rr=fallback[i*3]*.45,gg=fallback[i*3+1]*.45,bb=fallback[i*3+2]*.45;
    if(zc>1e-9){
      const x=xc/zc,y=yc/zc,r2=x*x+y*y,radial=1+k1*r2+k2*r2*r2+k3*r2*r2*r2;
      const xd=x*radial+2*p1*x*y+p2*(r2+2*x*x);
      const yd=y*radial+p1*(r2+2*y*y)+2*p2*x*y;
      const u=Math.round(fx*xd+cx),v=Math.round(fy*yd+cy);
      if(u>=0&&u<pixels.width&&v>=0&&v<pixels.height){
        const p=(v*pixels.width+u)*4;
        rr=pixels.data[p]/255;gg=pixels.data[p+1]/255;bb=pixels.data[p+2]/255;colored++;
      }
    }
    out[i*3]=rr;out[i*3+1]=gg;out[i*3+2]=bb;
  }
  return {colors:out,colored,total:count};
}
