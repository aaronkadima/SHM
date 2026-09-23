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

## Runtime separation

Individual CDM-1 execution does not use the comparison Railway service.
`Dockerfile.cdm` installs only `requirements-cdm.txt`, locks the service to
`SHM_ENGINE_ID=cdm_1`, and listens on the host-provided `PORT` (default 8000).

Configure an independent HTTPS container host with:

- repository `aaronkadima/SHM` and a branch containing CDM-1;
- build context/root `backend`;
- Dockerfile `Dockerfile.cdm`;
- a public HTTPS domain forwarded to the service port;
- `STANDALONE_CORS_ORIGINS=https://aaronkadima.github.io`.

Check `<public-url>/health` for `role=standalone`, `engine_id=cdm_1` and
`ready=true`; then save the base URL in **Configurações → Conexões dos motores
→ Backend individual**.

Railway remains reserved for analyses with two or more engines. Visitors to
GitHub Pages do not need Docker installed locally.

For an optional local smoke test:

```sh
docker build -f backend/Dockerfile.cdm -t shm-cdm-1 backend
docker run --rm -p 8000:8000 shm-cdm-1
```

The `app/cdm_v285.py` source should remain synchronized with future approved
versions of the Inkscape CDM extension.
