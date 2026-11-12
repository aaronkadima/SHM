// Anotação Ground Truth: rasterização, mapa de rótulos (prioridade das classes finas), COCO,
// métricas (IoU/Dice/clDice), sugestões do CDM, janelas multiescala e ZIP válido.
import assert from "node:assert/strict";
import {GT_BY_ID,flattenBezier,flattenBSpline,spiralPoints,rebuildCurve,classMask,cropLabels,crc32,fillPolygon,labelMap,levelForZoom,rasterize,rleEncode,segMetrics,strokePolyline,suggestionsFromCdm,tileWindows,toCoco,zipStore} from "../src/annotationCore.js";
import {__cdmTest} from "../src/cdmBrowser.js";

const w=100,h=60;
const sq=fillPolygon(new Uint8Array(w*h),w,h,[[10,10],[30,10],[30,30],[10,30]]);
let a=0;for(const v of sq)a+=v;assert.equal(a,400,"quadrado 20×20 = 400 px");
const line=strokePolyline(new Uint8Array(w*h),w,h,[[5,50],[95,50]],3);
let l=0;for(const v of line)l+=v;assert.ok(l>=200&&l<=300,"traço de 3 px ≈ 270 px, obtido "+l);
// escala: vetor na pré-visualização (100 px) exportado em 200 px
const big=rasterize({shape:"polygon",points:[[10,10],[30,10],[30,30],[10,30]]},200,120,2);
let b=0;for(const v of big)b+=v;assert.equal(b,1600);

const items=[
  {id:"s",cls:"structure",level:"cena",shape:"polygon",points:[[0,0],[100,0],[100,60],[0,60]],status:"manual"},
  {id:"d",cls:"spalling_dark",level:"regiao",shape:"polygon",points:[[10,10],[30,10],[30,30],[10,30]],status:"manual"},
  {id:"c",cls:"cracks",level:"detalhe",shape:"crack",points:[[5,20],[95,20]],width:2,status:"accepted",zoom:12},
  {id:"p",cls:"corrosion_rust",level:"regiao",shape:"polygon",points:[[60,40],[70,40],[70,50]],status:"suggested"}
];
const lab=labelMap(items,w,h);
assert.equal(lab[20*w+20],GT_BY_ID.cracks.index,"fissura pinta por cima do desplacamento");
assert.equal(lab[15*w+15],GT_BY_ID.spalling_dark.index);
assert.equal(lab[55*w+90],GT_BY_ID.structure.index);
assert.equal(lab[45*w+68],GT_BY_ID.structure.index,"sugestão pendente não entra na máscara");
assert.equal(classMask(items,"corrosion_rust",w,h).reduce((s,v)=>s+v,0),0);

const coco=toCoco(items,{fileName:"x.jpg",width:w,height:h});
assert.equal(coco.annotations.length,3);assert.equal(coco.categories.length,7);
const crack=coco.annotations.find(x=>x.category_id===GT_BY_ID.cracks.index);
assert.ok(crack.segmentation.counts&&crack.shm.polyline.length===2&&crack.shm.annotated_zoom===12);
const rle=rleEncode(sq,w,h);assert.equal(rle.counts.reduce((s,v)=>s+v,0),w*h);
assert.ok(Array.isArray(coco.annotations.find(x=>x.category_id===GT_BY_ID.spalling_dark.index).segmentation[0]));

const gt=classMask(items,"cracks",w,h),pred=strokePolyline(new Uint8Array(w*h),w,h,[[5,20],[60,20]],2);
const m=segMetrics(gt,pred,mask=>__cdmTest.zhangSuen(Uint8Array.from(mask),w,h));
assert.ok(m.precision>.95&&m.recall>.5&&m.recall<.7,"60% da fissura detectada");
assert.ok(m.cldice>.5&&m.cldice<.9);assert.equal(segMetrics(gt,gt).iou,1);

const sug=suggestionsFromCdm([{class:"cracks",points:[[0,0],[10,10]],width_px:3},{class:"spalling_dark",closed:true,points:[[0,0],[4,0],[4,4]]},{class:"growth",points:[[1,1]]}],2);
assert.equal(sug.length,2);assert.equal(sug[0].shape,"crack");assert.equal(sug[0].width,6);assert.equal(sug[1].shape,"polygon");assert.equal(sug[0].status,"suggested");

const wins=tileWindows(2000,1000);assert.equal(wins.length,1+4+16);
assert.ok(wins.every(x=>Math.max(x.out_w,x.out_h)<=512));
const crop=cropLabels(lab,w,{x:0,y:0,w:50,h:30,out_w:25,out_h:15});assert.equal(crop.length,375);
assert.equal(levelForZoom(1),"cena");assert.equal(levelForZoom(3),"regiao");assert.equal(levelForZoom(12),"detalhe");

assert.equal(crc32(new TextEncoder().encode("123456789")),0xcbf43926);
const zip=zipStore([{name:"a.txt",data:"olá"},{name:"d/b.bin",data:new Uint8Array([1,2,3])}]);
const bytes=new Uint8Array(await zip.arrayBuffer()),dv=new DataView(bytes.buffer);
assert.equal(dv.getUint32(0,true),0x04034b50);assert.equal(dv.getUint32(bytes.length-22,true),0x06054b50);assert.equal(dv.getUint16(bytes.length-12,true),2);
// Curvas: Bézier passa pelos nós, B-spline aberta toca as pontas, espiral termina no raio.
const bz=flattenBezier([{p:[0,0],hin:[0,0],hout:[0,10]},{p:[20,0],hin:[20,10],hout:[20,0]}]);
assert.deepEqual(bz[0],[0,0]);assert.ok(Math.abs(bz.at(-1)[0]-20)<1e-9);assert.ok(Math.max(...bz.map(p=>p[1]))>7,"alças puxam a curva");
const bzc=flattenBezier([{p:[0,0],hin:[0,0],hout:[0,0]},{p:[10,0],hin:[10,0],hout:[10,0]},{p:[10,10],hin:[10,10],hout:[10,10]}],true);
assert.ok(dist2(bzc.at(-1),[10,10])>0||bzc.length>3);
function dist2(a,b){return Math.hypot(a[0]-b[0],a[1]-b[1])}
const bs=flattenBSpline([[0,0],[10,20],[20,0],[30,20]]);
assert.deepEqual(bs[0],[0,0]);assert.deepEqual(bs.at(-1),[30,20]);assert.ok(Math.max(...bs.filter(p=>p[0]>5&&p[0]<15).map(p=>p[1]))<19,"B-spline aproxima (não interpola) os pontos internos");
const bsc=flattenBSpline([[0,0],[10,0],[10,10],[0,10]],true);assert.equal(bsc.length,64);
const sp=spiralPoints({center:[50,50],radius:20,arg:0,turns:3,exp:1});
assert.ok(dist2(sp.at(-1),[70,50])<1e-6);assert.ok(dist2(sp[0],[50,50])<1e-6);
const rb=rebuildCurve({shape:"polygon",points:[],curve:{kind:"bspline",closed:true,ctrl:[[10,10],[40,10],[40,40],[10,40]]}});
const rm=rasterize(rb,60,60);let ra=0;for(const v of rm)ra+=v;assert.ok(ra>300&&ra<900,"B-spline fechada preenchida: "+ra);
assert.ok(toCoco([{...rb,cls:"spalling_dark",level:"regiao",status:"manual"}],{fileName:"x",width:60,height:60}).annotations[0].shm.curve.kind==="bspline");
console.log("Annotation passed: curves (Bézier/B-spline/espiral), raster, label priority, COCO polygons/RLE, IoU/Dice/clDice, CDM suggestions, multiscale tiles, ZIP.");
