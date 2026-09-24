import assert from "node:assert/strict";
import {analysisExecutionIssue,executionEndpointIssue} from "../src/executionConfig.js";

const engines=[
  {id:"cdm_1",name:"CDM-1",browser_ready:true},
  {id:"opencv_crack",name:"OpenCV Crack Baseline",browser_ready:true},
  {id:"backend_model",name:"Backend Model",browser_ready:false}
];
const browserSupported=id=>id==="cdm_1"||id==="opencv_crack";

assert.match(analysisExecutionIssue({selected:[],engines,browserSupported,hostname:"aaronkadima.github.io"}),/Selecione pelo menos um motor/);
assert.equal(analysisExecutionIssue({selected:["cdm_1"],engines,browserSupported,hostname:"aaronkadima.github.io"}),"");
assert.equal(analysisExecutionIssue({selected:["opencv_crack"],engines,browserSupported,hostname:"aaronkadima.github.io"}),"");
assert.match(analysisExecutionIssue({selected:["backend_model"],engines,browserSupported,hostname:"aaronkadima.github.io"}),/Configure o endereço HTTPS/);
assert.equal(analysisExecutionIssue({selected:["backend_model"],engines,individualApi:"https://engine.example.com",browserSupported,hostname:"aaronkadima.github.io"}),"");
assert.match(analysisExecutionIssue({selected:["backend_model"],engines,individualApi:"http://engine.example.com",browserSupported,hostname:"aaronkadima.github.io"}),/site público exige/);
assert.equal(analysisExecutionIssue({selected:["cdm_1","backend_model"],engines,comparatorApi:"https://compare.example.com",browserSupported,hostname:"aaronkadima.github.io"}),"");
assert.match(analysisExecutionIssue({selected:["cdm_1","backend_model"],engines,comparatorApi:"http://127.0.0.1:8000",browserSupported,hostname:"aaronkadima.github.io"}),/site público exige/);
assert.equal(analysisExecutionIssue({selected:["backend_model"],engines,individualApi:"http://127.0.0.1:8000",browserSupported,hostname:"localhost"}),"");
assert.match(executionEndpointIssue("notaurl",{label:"comparador cloud",hostname:"aaronkadima.github.io"}),/não é uma URL válida/);
assert.match(executionEndpointIssue("ftp://example.com",{label:"comparador cloud",hostname:"aaronkadima.github.io"}),/HTTP ou HTTPS/);

console.log("EXECUTION_CONFIG_PASS");
