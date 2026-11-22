// Idiomas da plataforma: dicionário completo (EN, ES, FR) e tradução de textos usados nas figuras.
import assert from "node:assert/strict";
import {DICT} from "../src/i18nDict.js";
import {LANGS,tr,setLang,getLang} from "../src/i18n.js";
assert.deepEqual(LANGS.map(l=>l.code),["PT","EN","ES","FR"]);
for(const[k,v]of Object.entries(DICT)){assert.ok(Array.isArray(v)&&v.length===3,"entrada incompleta: "+k);for(const t of v)assert.ok(typeof t==="string"&&t.length>0,"tradução vazia: "+k)}
assert.equal(tr("Desplacamento/região escura","en"),"Spalling/dark region");
assert.equal(tr("Potencial do random walker","fr"),"Potentiel du random walker");
assert.equal(tr("4 · Potencial do random walker","es"),"4 · Potencial del random walker");
assert.equal(tr("limiar 0,5","en"),"threshold 0.5");
assert.equal(tr("Texto sem tradução","en"),"Texto sem tradução","texto desconhecido fica em português");
assert.equal(tr("Arquivo","pt"),"Arquivo");
console.log("i18n passed:",{entries:Object.keys(DICT).length,langs:LANGS.map(l=>l.code).join("/")});
