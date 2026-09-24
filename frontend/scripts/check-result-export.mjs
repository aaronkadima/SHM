import assert from "node:assert/strict";
import {buildComparisonCsv} from "../src/resultExport.js";

const csv=buildComparisonCsv({
  metadata:{client_elapsed_ms:1234.5},
  results:[{
    name:"CDM-1",
    status:"ok",
    latency_ms:87,
    detections:[{label:"crack",canonical_label:"crack",score:.91,box:[1,2,30,40],area_px:120}]
  }]
});

const lines=csv.replace(/^\uFEFF/,"").split("\n");
assert.equal(lines.length,2);
assert.match(lines[0],/"analysis_elapsed_ms"/);
assert.match(lines[1],/"87"/);
assert.match(lines[1],/"1234.5"/);
assert.match(lines[1],/"crack"/);

const noDuration=buildComparisonCsv({results:[{name:"X",status:"ok",latency_ms:3,detections:[]}]});
assert.match(noDuration,/"latency_ms","analysis_elapsed_ms"/);

console.log("RESULT_EXPORT_PASS");
