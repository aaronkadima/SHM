import assert from "node:assert/strict";
import {detectAsset,SUPPORTED_IMAGE_EXTENSIONS,SUPPORTED_MODEL_EXTENSIONS} from "../src/assetDetection.js";

const file=(name,type="")=>({name,type});

assert.equal(detectAsset(null),null);
assert.equal(detectAsset(file("bridge.JPG")),"2d");
assert.equal(detectAsset(file("scan.tiff")),"2d");
assert.equal(detectAsset(file("capture.bin","image/png")),"2d");
assert.equal(detectAsset(file("deck.GLB")),"3d");
assert.equal(detectAsset(file("mesh.obj")),"3d");
assert.equal(detectAsset(file("cloud.PLY")),"3d");
assert.equal(detectAsset(file("solid.stl")),"3d");
assert.equal(detectAsset(file("notes.pdf","application/pdf")),"unknown");
assert.equal(detectAsset(file("README")),"unknown");
assert.ok(SUPPORTED_IMAGE_EXTENSIONS.includes("png"));
assert.ok(SUPPORTED_MODEL_EXTENSIONS.includes("glb"));

console.log("ASSET_DETECTION_PASS");
