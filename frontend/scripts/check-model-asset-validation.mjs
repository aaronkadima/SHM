import assert from "node:assert/strict";
import {externalGltfUris,standaloneGltfIssue} from "../src/modelAssetValidation.js";

const embedded={
  asset:{version:"2.0"},
  buffers:[{uri:"data:application/octet-stream;base64,AAAA"}],
  images:[{uri:"data:image/png;base64,AAAA"}]
};
assert.deepEqual(externalGltfUris(embedded),[]);
assert.equal(standaloneGltfIssue(JSON.stringify(embedded)),null);

const externalBuffer={asset:{version:"2.0"},buffers:[{uri:"bridge.bin"}]};
assert.deepEqual(externalGltfUris(externalBuffer),["bridge.bin"]);
assert.match(standaloneGltfIssue(externalBuffer),/bridge\.bin/);
assert.match(standaloneGltfIssue(externalBuffer),/GLB/);

const externalTexture={asset:{version:"2.0"},images:[{uri:"textures/crack.png"},{uri:"textures/crack.png"}]};
assert.deepEqual(externalGltfUris(externalTexture),["textures/crack.png"]);
assert.match(standaloneGltfIssue(externalTexture),/textures\/crack\.png/);

assert.throws(()=>externalGltfUris("{invalid json"));

console.log("MODEL_ASSET_VALIDATION_PASS");
