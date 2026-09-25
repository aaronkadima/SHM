const MODEL_EXT=/\.(glb|gltf|obj|ply|stl|las|xyz|ifc)$/i;
const SPATIAL_EXT=/\.(las|xyz|ifc)$/i;
const IMAGE_EXT=/\.(png|jpe?g|webp|bmp|svg|avif)$/i;
const IMAGE_MIME=new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/bmp",
  "image/x-ms-bmp",
  "image/svg+xml",
  "image/avif"
]);

export function detectAsset(file){
  if(!file)return null;
  const name=String(file.name||"").toLowerCase();
  const type=String(file.type||"").toLowerCase();
  if(IMAGE_MIME.has(type)||IMAGE_EXT.test(name))return "2d";
  if(MODEL_EXT.test(name))return "3d";
  return "unknown";
}

export function isCdm3SpatialAsset(file){
  return !!file&&SPATIAL_EXT.test(String(file.name||"").toLowerCase());
}

export const SUPPORTED_IMAGE_EXTENSIONS=["png","jpg","jpeg","webp","bmp","svg","avif"];
export const SUPPORTED_MODEL_EXTENSIONS=["glb","gltf","obj","ply","stl","las","xyz","ifc"];
export const CDM3_SPATIAL_EXTENSIONS=["las","xyz","ifc"];
