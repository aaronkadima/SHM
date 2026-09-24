import {sha256Blob} from "../src/fileIntegrity.js";

const expected="ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
const got=await sha256Blob(new Blob(["abc"],{type:"text/plain"}));
if(got!==expected){
  console.error("SHA-256 integrity check failed:",{expected,got});
  process.exit(1);
}
const empty=await sha256Blob(null);
if(empty!==null){
  console.error("Null blob must return null hash.");
  process.exit(1);
}
console.log("Browser SHA-256 helper passed.");
