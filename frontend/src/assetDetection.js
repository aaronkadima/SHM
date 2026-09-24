const MODEL_EXT=/\.(glb|gltf|obj|ply|stl)$/i;
const IMAGE_EXT=/\.(png|jpe?g|webp|tiff?|bmp)$/i;

export function detectAsset(file){
  if(!file)return null;
  const name=String(file.name||"").toLowerCase();
  const type=String(file.type||"").toLowerCase();
  if(type.startsWith("image/")||IMAGE_EXT.test(name))return "2d";
  if(MODEL_EXT.test(name))return "3d";
  return "unknown";
}

export const SUPPORTED_IMAGE_EXTENSIONS=["png","jpg","jpeg","webp","tif","tiff","bmp"];
export const SUPPORTED_MODEL_EXTENSIONS=["glb","gltf","obj","ply","stl"];
