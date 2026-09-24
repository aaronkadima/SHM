export async function sha256Blob(blob){
  if(!blob)return null;
  const buffer=await blob.arrayBuffer();
  const digest=await crypto.subtle.digest("SHA-256",buffer);
  return [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,"0")).join("");
}
