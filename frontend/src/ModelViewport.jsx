import React,{useEffect,useRef,useState} from "react";
import * as THREE from "three";
import {OrbitControls} from "three/addons/controls/OrbitControls.js";
import {GLTFLoader} from "three/addons/loaders/GLTFLoader.js";
import {OBJLoader} from "three/addons/loaders/OBJLoader.js";
import {PLYLoader} from "three/addons/loaders/PLYLoader.js";
import {STLLoader} from "three/addons/loaders/STLLoader.js";

export default function ModelViewport({file}){
  const mount=useRef(null),[error,setError]=useState("");
  useEffect(()=>{
    if(!file||!mount.current)return;
    const el=mount.current,scene=new THREE.Scene();scene.background=new THREE.Color(0xdce4e7);
    const camera=new THREE.PerspectiveCamera(45,1,.01,100000);
    const renderer=new THREE.WebGLRenderer({antialias:true});renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));el.appendChild(renderer.domElement);
    const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;
    scene.add(new THREE.HemisphereLight(0xffffff,0x8195a0,2));
    const light=new THREE.DirectionalLight(0xffffff,2);light.position.set(3,5,7);scene.add(light);
    const resize=()=>{const w=el.clientWidth,h=el.clientHeight;camera.aspect=w/h;camera.updateProjectionMatrix();renderer.setSize(w,h)};
    const observer=new ResizeObserver(resize);observer.observe(el);resize();
    let disposed=false,model=null;const url=URL.createObjectURL(file),ext=file.name.split(".").pop().toLowerCase();
    const fit=obj=>{
      if(disposed)return;model=obj;scene.add(obj);
      const bounds=new THREE.Box3().setFromObject(obj),size=bounds.getSize(new THREE.Vector3()),center=bounds.getCenter(new THREE.Vector3());
      if(!Number.isFinite(size.length())||size.length()===0)throw new Error("Geometria vazia.");
      controls.target.copy(center);camera.position.copy(center).add(new THREE.Vector3(size.length()*.9,size.length()*.7,size.length()*.9));camera.near=Math.max(.001,size.length()/10000);camera.far=Math.max(100,size.length()*100);camera.updateProjectionMatrix();controls.update()
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
    let animation;const draw=()=>{animation=requestAnimationFrame(draw);controls.update();renderer.render(scene,camera)};draw();
    return()=>{disposed=true;cancelAnimationFrame(animation);observer.disconnect();controls.dispose();scene.remove(model);model?.traverse?.(n=>{n.geometry?.dispose();if(n.material){const materials=Array.isArray(n.material)?n.material:[n.material];materials.forEach(m=>m.dispose())}});renderer.dispose();renderer.domElement.remove();URL.revokeObjectURL(url)}
  },[file]);
  return <div className="modelViewport" ref={mount}>{error&&<div className="modelError" role="alert">{error}</div>}<div className="modelHint">3D · arraste para orbitar · roda para ampliar · botão direito para deslocar</div></div>
}
