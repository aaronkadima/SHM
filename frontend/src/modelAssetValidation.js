export function externalGltfUris(source){
  const document=typeof source==="string"?JSON.parse(source):source;
  const resources=[...(document?.buffers||[]),...(document?.images||[])];
  return [...new Set(resources
    .map(resource=>typeof resource?.uri==="string"?resource.uri.trim():"")
    .filter(uri=>uri&&!/^data:/i.test(uri))
  )];
}

export function standaloneGltfIssue(source){
  const external=externalGltfUris(source);
  if(!external.length)return null;
  const sample=external.slice(0,3).join(", ");
  return "GLTF possui dependências externas ("+sample+(external.length>3?", …":"")+"). Importe um GLTF autônomo ou converta o conjunto para GLB.";
}
