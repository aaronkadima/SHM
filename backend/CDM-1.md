# CDM-1

CDM-1 reuses the Concrete Damage Morphology v2.8.5 Python source in
`app/cdm_v285.py`. It runs the five-stage deterministic morphology protocol:
base image, family-specific response, candidate mask, opening/closing and
connected-component filtering.

The current-image result is organized as independent layers for exposed
reinforcement, spalling, apparent corrosion, efflorescence and cracks. Each
accepted CDM record keeps its vector geometry and quantitative metrics. Confidence
scores remain null because the deterministic morphology output has not been
probabilistically calibrated.

## t0 → t1 temporal comparison

The standalone `/infer` endpoint accepts an optional multipart field
`previous_file`. When supplied, the service processes that image as t0 and the
main `file` as t1. The current implementation aligns t0 to the processed t1
dimensions by resize, executes the same CDM protocol on both images, and computes
per-family:

- mask IoU;
- growth area in pixels²;
- reduction area in pixels²;
- independent vector layers for temporal growth and temporal reduction.

The frontend exposes the t0 image through **Referência t0** and adds a **t0 / t1**
canvas mode. Temporal layers remain independently visible/hidden, matching the
layer-based Inkscape workflow.

## Parameters

For individual inference, `/infer` accepts:

- `cdm_threshold`;
- `cdm_kernel_size`;
- `cdm_min_area`;
- `cdm_min_aspect_ratio`;
- `cdm_mm_per_px`;
- `cdm_element_family`;
- optional `previous_file` for t0.

The frontend persists the CDM parameters locally. NT/EC/GDE values are
image-assisted preliminary classifications and require engineering validation.

## Exports

The SHM frontend generates exports from the accepted CDM vector records rather
than from a screenshot of the overlay:

- **SVG** — native Inkscape layer groups, including temporal change layers;
- **CSV** — object geometry, measurements, temporal statistics and preliminary
  classification summary;
- **COCO JSON** — current-image pathology annotations;
- **DXF** — one CAD layer per pathology plus temporal growth/reduction;
- **BIM JSON** — image-local geometry and inspection metadata for downstream
  BrIM/Digital Twin association;
- **IFC4** — `IfcAnnotation` geometry and
  `Pset_ConcreteDamageAssessment`; enabled only when `mm/px > 0` so physical
  coordinates are not fabricated without calibration;
- **HTML** — standalone inspection report with current findings, preliminary
  NT/EC/GDE, t0→t1 statistics and traceability fields.

The original imported image remains separate from the vector pathology layers in
the SHM workspace.

## Browser-native individual runtime

CDM-1 now also has a deterministic browser implementation in
`frontend/src/cdmBrowser.js`. For a single selected CDM-1 engine, SHM executes
the morphology pipeline locally in the browser and does not require a network
request. The t0 reference image is also processed locally. This removes the
public-site dependency on an individual HTTPS backend for CDM-1 and ensures that
the image is not sent to Railway.

The Python implementation remains the reference/runtime option for validation,
automation and server-side use.

## Runtime separation

Individual CDM-1 execution does not use the comparison Railway service.
`Dockerfile.cdm` installs only `requirements-cdm.txt`, locks the optional
standalone service to `SHM_ENGINE_ID=cdm_1`, and listens on the host-provided
`PORT` (default 8000).

If a server-side CDM endpoint is desired, configure an independent HTTPS
container host with:

- repository `aaronkadima/SHM` and a branch containing CDM-1;
- build context/root `backend`;
- Dockerfile `Dockerfile.cdm`;
- a public HTTPS domain forwarded to the service port;
- `STANDALONE_CORS_ORIGINS=https://aaronkadima.github.io`.

Check `<public-url>/health` for `role=standalone`, `engine_id=cdm_1` and
`ready=true`; then save the base URL in **Configurações → Conexões dos motores
→ Backend individual**.

Railway remains reserved for analyses with two or more engines. CDM-1 visitors
to GitHub Pages do not need Docker or an individual backend installed locally.

For an optional local smoke test:

```sh
docker build -f backend/Dockerfile.cdm -t shm-cdm-1 backend
docker run --rm -p 8000:8000 shm-cdm-1
```

The `app/cdm_v285.py` source should remain synchronized with future approved
versions of the Inkscape CDM extension.


## Python ↔ browser parity

The repository includes a deterministic cross-runtime regression:

- `backend/tests/generate_cdm_parity_fixture.py` creates controlled t0/t1 RGB
  inputs and computes the reference outputs with the Python CDM 2.8.5 source;
- `frontend/scripts/check-cdm-parity.mjs` runs the same pixels through the
  browser morphology core and checks masks, accepted records, summary metrics,
  NT/EC/GDE and temporal growth/reduction;
- `.github/workflows/cdm-parity.yml` executes this comparison automatically
  whenever the Python or browser CDM implementation changes.

The current synthetic regression exercises all five pathology masks and accepted
records for cracks, spalling, exposed reinforcement, apparent corrosion and
efflorescence. It also exercises t0→t1 growth statistics.

## Temporal history persistence

When a CDM-1 inspection contains a t0 reference, SHM stores both the current
image and the reference image in the local IndexedDB record. Reopening the
inspection restores the two source files and keeps the t0/t1 canvas mode
available. History summaries identify records with a saved reference and a
temporal comparison.


## Browser performance

The browser runtime executes the morphology core in a dedicated module Web
Worker. Image decoding and final overlay rasterization remain on the UI thread,
while percentile estimation, morphology, connected components, record geometry,
condition rating and temporal comparison run off the main thread. If Web Workers
are unavailable or fail to initialize, SHM re-decodes the source images and
falls back to the validated synchronous core. The result records the selected
runtime in `metrics.runtime` and exposes any fallback error in
`metrics.worker_error`.


## Execution control and temporal traceability

Browser CDM-1 runs are identified by a unique execution id in the React session
and use an `AbortController`. Cancelling a run terminates the morphology Web
Worker, prevents stale results from replacing a newer inspection, and prevents a
cancelled result from being persisted to IndexedDB.

The worker emits staged progress for current-image segmentation, vectorization,
optional t0 segmentation, temporal comparison, condition rating and finalization.
The result stores measured browser timings in `metrics.performance_ms`:
decoding, morphology core, overlay rendering and total elapsed time.

Temporal records expose `source_class` in addition to the change class
(`growth` or `reduction`). Therefore a record can state, for example,
`damage_class=growth` and `source_class=cracks`. Temporal overlays are split
by both dimensions, matching the Inkscape convention more closely. The same
traceability is preserved in layered SVG, technical CSV, pathology-specific DXF
layers, BIM JSON and IFC `Pset_ConcreteDamageAssessment.SourcePathology`.

The parity CI also validates monotonic progress stages and temporal source-class
propagation through these export formats.


## Automatic t0→t1 registration

Temporal comparison now supports `translation_auto` (default) in addition to
plain `resize`. After resizing t0 to the processed t1 dimensions, CDM builds a
low-resolution luminance-edge representation and searches a fixed central ROI
for the integer translation that minimizes edge mismatch. The search radius is
12% of the smaller processed image dimension, capped at 96 px.

A non-zero translation is applied only when it improves the edge-match score by
at least 3.5% and the optimum is not on the search boundary. If the optimum hits
that boundary, the registration is rejected with
`reason=search_boundary_hit`; this avoids silently accepting a partial
correction when the camera moved farther than the supported search range.
Invalid translated borders are filled with t1 pixels so missing t0 coverage does
not create artificial growth/reduction along the image edges.

The temporal result records:

- requested/applied method;
- accepted/rejected state and reason;
- applied and estimated Δx/Δy in processed pixels;
- edge-match score before/after;
- relative improvement;
- downsample step and search radius.

When a translation is actually applied, SHM also produces an aligned t0 preview.
The canvas uses that aligned reference in the t0/t1 view and lets the operator
toggle back to the raw t0 for visual verification. The aligned preview is not
duplicated in history when no translation was applied.

Current scope is translation registration only. Rotation, scale variation and
projective/perspective changes are not corrected by this stage and should be
controlled during image acquisition or handled by a later registration stage.

The cross-runtime CI includes a known camera-shift fixture. A t0 image shifted
+6 px in X and -4 px in Y must be recovered as Δx=-6 px and Δy=+4 px by both
Python and the browser implementation.


### Audit outputs for registration

When automatic translation is accepted, the aligned t0 image used by the
algorithm is available in the canvas and can be exported as
`cdm-1-t0-alinhado.png`. The operator can toggle between the aligned and raw t0
inside the temporal comparison without modifying the computed result.

Registration provenance is embedded in the technical outputs:

- SVG: `cdm-temporal-alignment` metadata;
- CSV: temporal alignment method, Δx, Δy and relative improvement;
- DXF: `999` temporal-alignment audit comment plus pathology-specific temporal layers;
- BIM JSON: full `temporal.alignment` object;
- IFC: temporal annotations include alignment method, Δx, Δy and improvement in
  `Pset_ConcreteDamageAssessment`.

The local inspection-history summary also stores the applied temporal alignment,
so reopened campaigns expose the displacement without parsing an export file.

CLI usage can select the same behavior with
`--alignment_method translation_auto` (default) or
`--alignment_method resize`.


## Temporal quality gate

Temporal growth/reduction is now guarded by a deterministic acquisition-quality
assessment (\`cdm_temporal_quality_v1\`). The gate does not decide whether damage
exists; it decides whether the t0/t1 pair is sufficiently compatible for change
quantification.

The same gate runs in the Python/Inkscape and browser implementations. It checks:

- useful overlap after the applied temporal translation;
- mean-luminance difference between t1 and aligned t0;
- relative edge-energy/sharpness between the two acquisitions;
- clipped dark/bright pixel fraction;
- registration failure reasons such as \`search_boundary_hit\`.

Current deterministic limits are:

- overlap: fail below 0.85; warning below 0.92;
- normalized mean-luminance difference: fail above 0.22; warning above 0.12;
- sharpness ratio \`min(t0,t1)/max(t0,t1)\`: fail below 0.45; warning below 0.65;
- clipped fraction: fail above 0.35; warning above 0.20.

A hard issue sets
\`validated_for_change_quantification=false\`. Temporal masks, records and areas
remain available for inspection/audit, but the UI labels them as not validated
instead of presenting them as confirmed structural change. Warnings preserve the
validation flag but are shown explicitly.

The quality gate is persisted in local history and embedded in browser-generated
SVG, CSV, DXF, BIM JSON, IFC and HTML outputs. Native CDM CSV/BIM metadata and
the Inkscape result text also include the temporal-quality state.

The CI parity fixture now includes:
- a normal t0/t1 pair that passes;
- excessive illumination change that must fail with \`illumination_mismatch\`;
- strong relative blur that must fail with \`sharpness_mismatch\`;
- an out-of-range camera translation that must fail through
  \`registration_unreliable\`.


## Residual geometric consistency

The temporal quality gate also measures residual edge-map agreement after the
selected alignment strategy. This protects the explicit \`resize\` mode from
silently accepting a pair that is still displaced, rotated, rescaled or otherwise
geometrically inconsistent.

The metric is the Pearson correlation between t1 and aligned-t0 edge-magnitude
maps, reported as \`metrics.edge_similarity\`. Current deterministic thresholds:

- fail below 0.35 → \`geometric_mismatch\`;
- warning below 0.55 → \`geometric_consistency_low\`;
- otherwise no residual-geometry warning is raised.

This metric complements, rather than replaces, translation registration. A pair
with a supported camera translation should first be aligned by
\`translation_auto\`; the residual similarity then checks whether the remaining
geometry is still coherent. In \`resize\` mode a translated pair can therefore
fail the quality gate even though translation correction was intentionally
disabled.

When temporal quality is \`fail\`, growth/reduction layers remain in the layer
tree for audit but are hidden by default. They are shown only if the operator
explicitly enables them. This prevents an invalidated temporal result from being
presented visually as confirmed change.

Residual geometric similarity is persisted in local history and exported in the
browser CSV, BIM/IFC/HTML outputs and native CDM CSV/result text.


## Longitudinal campaigns

The local SHM history now groups persisted inspections by
\`OAE + element_id\` into longitudinal campaigns. Campaigns use only saved
inspection summaries and previously validated pairwise temporal deltas. They do
not interpolate missing inspections, recompute old images, or accumulate
growth/reduction across unrelated pairs.

Each new CDM-1 history entry stores a lightweight snapshot containing pathology
areas, NT/EC/GDE condition values and validated temporal deltas. Legacy entries
without that snapshot remain readable and are explicitly identified as older
records.

Campaign panels expose:

- inspection count and covered date range;
- latest NT/EC/GDE condition state;
- a GDE sparkline based only on recorded condition snapshots;
- validated pairwise temporal events by pathology;
- CSV and JSON campaign audit exports;
- a “Nova t1 · último como t0” workflow that prepares the latest saved image as
  the reference for the next CDM-1 inspection.

When the latest inspection is reused as t0, the new record persists the
\`reference_inspection_id\`. Manually supplied references remain explicitly
unlinked. The campaign CSV/JSON exports carry this provenance so a temporal pair
can be traced back to the historical inspection that supplied t0.

Linked historical t0 images are deduplicated in IndexedDB: the dependent record
references the original inspection instead of storing the same image blob again.
When a referenced inspection is manually deleted, its image is materialized into
the dependent record before deletion so the temporal pair remains reopenable.
Automatic history pruning preserves records that are still referenced by newer
inspections.

The history header reports the browser's real storage estimate and whether
persistent storage has been granted. These values are reported by the browser;
SHM does not synthesize a storage quota or usage estimate.
