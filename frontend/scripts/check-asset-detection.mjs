import assert from "node:assert/strict";
import {detectAsset,isCdm3SpatialAsset,SUPPORTED_IMAGE_EXTENSIONS,SUPPORTED_MODEL_EXTENSIONS,CDM3_SPATIAL_EXTENSIONS} from "../src/assetDetection.js";

const file=(name,type="")=>({name,type});

assert.equal(detectAsset(null),null);
assert.equal(detectAsset(file("bridge.JPG")),"2d");
assert.equal(detectAsset(file("drawing.svg","image/svg+xml")),"2d");
assert.equal(detectAsset(file("deck.avif","image/avif")),"2d");
assert.equal(detectAsset(file("capture.bin","image/png")),"2d");
assert.equal(detectAsset(file("deck.GLB")),"3d");
assert.equal(detectAsset(file("mesh.obj")),"3d");
assert.equal(detectAsset(file("cloud.PLY")),"3d");
assert.equal(detectAsset(file("solid.stl")),"3d");
assert.equal(detectAsset(file("bridge.las")),"3d");
assert.equal(detectAsset(file("survey.XYZ")),"3d");
assert.equal(detectAsset(file("model.IFC")),"3d");
assert.equal(isCdm3SpatialAsset(file("bridge.las")),true);
assert.equal(isCdm3SpatialAsset(file("survey.xyz")),true);
assert.equal(isCdm3SpatialAsset(file("model.ifc")),true);
assert.equal(isCdm3SpatialAsset(file("mesh.obj")),false);
assert.equal(detectAsset(file("scan.tiff","image/tiff")),"unknown");
assert.equal(detectAsset(file("animation.gif","image/gif")),"unknown");
assert.equal(detectAsset(file("phone.heic","image/heic")),"unknown");
assert.equal(detectAsset(file("notes.pdf","application/pdf")),"unknown");
assert.equal(detectAsset(file("README")),"unknown");
assert.ok(SUPPORTED_IMAGE_EXTENSIONS.includes("png"));
assert.ok(SUPPORTED_IMAGE_EXTENSIONS.includes("svg"));
assert.ok(SUPPORTED_MODEL_EXTENSIONS.includes("glb"));
assert.ok(SUPPORTED_MODEL_EXTENSIONS.includes("las"));
assert.ok(SUPPORTED_MODEL_EXTENSIONS.includes("xyz"));
assert.ok(SUPPORTED_MODEL_EXTENSIONS.includes("ifc"));
assert.deepEqual(CDM3_SPATIAL_EXTENSIONS,["las","xyz","ifc"]);

console.log("ASSET_DETECTION_PASS");
