import React,{useEffect,useRef,useState} from "react";
import * as THREE from "three";
import {OrbitControls} from "three/addons/controls/OrbitControls.js";
import {GLTFLoader} from "three/addons/loaders/GLTFLoader.js";
import {OBJLoader} from "three/addons/loaders/OBJLoader.js";
import {PLYLoader} from "three/addons/loaders/PLYLoader.js";
import {STLLoader} from "three/addons/loaders/STLLoader.js";
import {SVGRenderer} from "three/addons/renderers/SVGRenderer.js";

export default function ModelViewport({file}){
  const mount=useRef(null),view=useRef(null),[error,setError]=useState(""),[fallback,setFallback]=useState(false);
  useEffect(()=>{
    if(!file||!mount.current)return;
    const el=mount.current,scene=new THREE.Scene();scene.background=new THREE.Color(0xdce4e7);
    const camera=new THREE.PerspectiveCamera(45,1,.01,100000);
    let renderer,vectorFallback=false,dirty=true;
    try{renderer=new THREE.WebGLRenderer({antialias:true});renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2))}
    catch{renderer=new SVGRenderer();vectorFallback=true;setFallback(true)}
    el.appendChild(renderer.domElement);
    const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;
    scene.add(new THREE.HemisphereLight(0xffffff,0x8195a0,2));
    const light=new THREE.DirectionalLight(0xffffff,2);light.position.set(3,5,7);scene.add(light);
    const resize=()=>{const w=Math.max(1,el.clientWidth),h=Math.max(1,el.clientHeight);camera.aspect=w/h;camera.updateProjectionMatrix();renderer.setSize(w,h);dirty=true};
    const observer=new ResizeObserver(resize);observer.observe(el);resize();
    let disposed=false,model=null;const url=URL.createObjectURL(file),ext=file.name.split(".").pop().toLowerCase();
    const fit=obj=>{
      if(disposed)return;model=obj;
      if(vectorFallback)obj.traverse(n=>{if(n.isMesh){
        const source=Array.isArray(n.material)?n.material[0]:n.material;
        n.material=new THREE.MeshBasicMaterial({color:source?.color?.clone()||new THREE.Color(0x689aa4),side:THREE.DoubleSide})
      }});
      scene.add(obj);
      const bounds=new THREE.Box3().setFromObject(obj),size=bounds.getSize(new THREE.Vector3()),center=bounds.getCenter(new THREE.Vector3());
      if(!Number.isFinite(size.length())||size.length()===0){scene.remove(obj);fail(new Error("Geometria vazia."));return}
      const radius=Math.max(size.length(),.01)*1.35;
      view.current={camera,controls,center:center.clone(),radius};
      controls.target.copy(center);camera.position.copy(center).add(new THREE.Vector3(radius,radius*.65,radius));camera.near=Math.max(.001,size.length()/10000);camera.far=Math.max(100,size.length()*100);camera.updateProjectionMatrix();controls.update();dirty=true
    };
    const fail=e=>!disposed&&setError("Não foi possível abrir o modelo: "+(e?.message||String(e)));
    try{
      if(ext==="glb"||ext==="gltf")new GLTFLoader().load(url,g=>fit(g.scene),undefined,fail);
      else if(ext==="obj")new OBJLoader().load(url,fit,undefined,fail);
      else if(ext==="stl"||ext==="ply"){
        const loader=ext==="stl"?new STLLoader():new PLYLoader();
        loader.load(url,g=>{g.computeVertexNormals();fit(new THREE.Mesh(g,new THREE.MeshStandardMaterial({color:0x8aaeb3,side:THREE.DoubleSide})))},undefined,fail)
      }else fail(new Error("Formato 3D não suportado pelo visualizador."));
    }catch(e){fail(e)}
    controls.addEventListener("change",()=>{dirty=true});
    let animation;const draw=()=>{animation=requestAnimationFrame(draw);controls.update();if(!vectorFallback||dirty){renderer.render(scene,camera);dirty=false}};draw();
    return()=>{disposed=true;view.current=null;cancelAnimationFrame(animation);observer.disconnect();controls.dispose();scene.remove(model);model?.traverse?.(n=>{n.geometry?.dispose();if(n.material){const materials=Array.isArray(n.material)?n.material:[n.material];materials.forEach(m=>m.dispose())}});renderer.dispose?.();renderer.domElement.remove();URL.revokeObjectURL(url)}
  },[file]);
  function setView(direction){
    const data=view.current;if(!data)return;
    const {camera,controls,center,radius}=data;
    const offsets={perspective:[1,.65,1],front:[0,0,1],top:[0,1,0],side:[1,0,0]};
    const offset=new THREE.Vector3(...offsets[direction]).normalize().multiplyScalar(radius*1.7);
    camera.position.copy(center).add(offset);camera.up.set(0,1,0);
    if(direction==="top")camera.up.set(0,0,-1);
    controls.target.copy(center);camera.lookAt(center);controls.update()
  }
  return <div className="modelViewport" ref={mount} role="region" aria-label="Visualizador 3D do modelo importado">{error&&<div className="modelError" role="alert">{error}</div>}<div className="modelViews" aria-label="Vistas do modelo 3D"><button onClick={()=>setView("perspective")}>Perspectiva</button><button onClick={()=>setView("front")}>Frontal</button><button onClick={()=>setView("top")}>Superior</button><button onClick={()=>setView("side")}>Lateral</button></div>{fallback&&<div className="modelFallback">Visualização vetorial · WebGL indisponível</div>}<div className="modelHint">3D · arraste para orbitar · roda para ampliar · botão direito para deslocar</div></div>
}
