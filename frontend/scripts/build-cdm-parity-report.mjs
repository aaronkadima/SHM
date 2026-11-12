// Relatório de paridade CDM Python ⇄ navegador (indicadores + dados para os gráficos do Studio).
// Entrada: casos gerados por backend/tests/generate_cdm_parity_report_cases.py (etapas do Python).
// Saída: JSON compacto lido pelo painel "Paridade CDM" (src/ParityPanel.jsx).
// Uso: node scripts/build-cdm-parity-report.mjs CASOS.json SAIDA.json
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import {execSync} from "node:child_process";
import {buildParityReport} from "../src/parityMetrics.js";

const [casesPath,outPath]=process.argv.slice(2);
if(!casesPath||!outPath)throw new Error("usage: node scripts/build-cdm-parity-report.mjs CASES.json OUT.json");
const input=JSON.parse(fs.readFileSync(casesPath,"utf8"));
const git=cmd=>{try{return execSync(cmd,{stdio:["ignore","pipe","ignore"]}).toString().trim()}catch{return null}};
const report=buildParityReport(input,{source:"ci_synthetic",commit:process.env.PARITY_COMMIT||git("git rev-parse HEAD"),branch:process.env.PARITY_BRANCH||git("git rev-parse --abbrev-ref HEAD"),node:process.version});
fs.mkdirSync(path.dirname(outPath),{recursive:true});
fs.writeFileSync(outPath,JSON.stringify(report));
const s=report.summary;
console.log(`CDM parity report: ${report.status.toUpperCase()} · ${s.cases} cases · IoU min ${s.clean_iou.toFixed(6)} · PMR máx ${(s.clean_pmr*100).toFixed(4)}% · ${(fs.statSync(outPath).size/1024).toFixed(0)} KB → ${outPath}`);
for(const t of report.tolerances)console.log(`${t.pass?"✓":"✗"} ${t.label}: ${t.value} (${t.rule} ${t.limit})`);
