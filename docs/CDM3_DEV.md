# CDM-3 — integração DEV

**Status:** experimental, branch `dev`. Não promover para `main` antes de concluir os gates de validação abaixo.

## Arquitetura implementada

### Estágio A — entorno
- Prior local a partir das classes ASPRS do próprio LAS/LAZ.
- Dynamic World, Sentinel-2, Sentinel-1 e Sen1Floods11 permanecem fontes de contexto geoespacial quando houver georreferenciamento confiável.
- Satélite não é usado como detector de fissuras ou de patologias milimétricas.

### Estágio B — componente estrutural
- Implementado: resolução geométrica ponto 3D -> elemento IFC mais próximo.
- O `host_element.ifc_global_id` é gravado no registro da patologia quando a geometria 3D permite associação confiável.
- Evolução prevista: classificador visual Open Images -> SemanticBridge como prior semântico; a identidade final do elemento continua sendo resolvida geometricamente.

### Estágio C — patologia
- Vocabulário: fissuras, desplacamento, armadura exposta, corrosão e eflorescência.
- Pipeline de treino: SegFormer B0 -> DACL10K remapeado -> fine-tuning com rótulos CDM curados.
- Sem `SHM_CDM3_CHECKPOINT`, o motor usa explicitamente o CDM-1 como bootstrap morfológico. O fallback é marcado em `metrics.runtime_mode=morphology_bootstrap`; a plataforma não apresenta esse resultado como inferência IA.
- Com checkpoint configurado, `runtime_mode=segformer_stage_c`.

## LAS <-> IFC

O módulo de alinhamento implementa ICP rígido como refinamento. ICP ponto-a-ponto não deve ser usado como única fonte de pose quando o alvo é dominado por superfícies planas (por exemplo, tabuleiro/laje), pois existe degenerescência geométrica. Para inspeções reais, usar GCP/RTK-GNSS ou uma inicialização equivalente e, quando possível, incluir feições não planares (pilares, vigas, guarda-corpos, juntas) antes do refinamento ICP.

## IFC + SVG

A exportação materializa cada patologia como:
1. `IfcAnnotation`;
2. vínculo ao elemento hospedeiro por `IfcRelAssignsToProduct`;
3. `Pset_CDM_Pathology`;
4. SVG vetorial com metadados de coordenadas, associado ao IFC como documento.

Endpoints DEV:
- `GET /cdm3/status`
- `POST /cdm3/las/summary`
- `POST /cdm3/ifc/resolve`
- `POST /cdm3/ifc/export`

Dependências espaciais opcionais:
```bash
pip install -r backend/requirements-cdm3.txt
```

## Gates antes de liberar para main

- [ ] Backend importa e inicia sem dependências opcionais instaladas.
- [ ] `GET /cdm3/status` responde e diferencia checkpoint ausente/configurado.
- [ ] CDM-3 aparece no catálogo DEV.
- [ ] Bootstrap morfológico produz camadas e registros sem alegar IA.
- [ ] Checkpoint Stage-C real passa validação por classe (IoU/Dice/Recall e conjunto externo).
- [ ] LAS real: resumo, classes ASPRS e contexto ambiental validados.
- [ ] LAS↔IFC: alinhamento validado com GCP/pose inicial e geometria não planar.
- [ ] IFC real: `by_guid`, unidade de comprimento e resolução do hospedeiro conferidos.
- [ ] Visualizador IFC confirma `IfcAnnotation` no elemento correto e SVG associado.
- [ ] Frontend DEV compila e `/SHM/dev/` carrega o catálogo atualizado.
- [ ] Testes/CI do branch `dev` passam.
- [ ] Somente após esses gates: PR/merge de `dev` para `main`.
