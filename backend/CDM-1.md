# CDM-1

CDM-1 reuses the user's Concrete Damage Morphology v2.8.5 Python source in
`app/cdm_v285.py`. It runs its five-stage image morphology protocol on the
backend: base image, family-specific response, candidate mask, opening and
closing, and connected-component filtering. It keeps the original layer order:
exposed reinforcement, spalling, apparent corrosion, efflorescence, cracks.

The response exposes one transparent PNG per family in `metrics.layers`,
one detection per accepted CDM record, plus the source's summary and image
condition rating in `metrics.summary`. The frontend displays these layers
independently and exports a vector SVG with native Inkscape layer groups, a
technical CSV, and COCO annotations from the accepted record geometry.
The source's t0/t1 comparison, DXF/IFC and HTML report exports are not yet
connected. Classifications are morphological candidates; scores are deliberately
null and NT/EC/GDE from a single image are preliminary.

For individual inference, start `uvicorn app.standalone:app` from `backend/`
and set its HTTPS address in SHM Settings. `/infer` accepts the optional form
fields `cdm_threshold`, `cdm_kernel_size`, `cdm_min_area`,
`cdm_min_aspect_ratio`, `cdm_mm_per_px`, and `cdm_element_family`.
The multi-engine comparator executes CDM-1 with the source defaults. The
public comparator only accepts two or more engines. The exported SVG contains
vector pathology layers, while the imported image remains the separate original
image in SHM.

## Independent HTTPS service

`Dockerfile.cdm` installs only `requirements-cdm.txt`, locks the service to
`SHM_ENGINE_ID=cdm_1`, and listens on the host-provided `PORT` (default 8000).
Configure a separate container host with:

- Repository `aaronkadima/SHM` and a branch containing CDM-1.
- Build context/root `backend` and Dockerfile `Dockerfile.cdm`.
- A public HTTPS domain forwarded to the service port.
- `STANDALONE_CORS_ORIGINS=https://aaronkadima.github.io`.

Check `<public-url>/health` for `role=standalone`, `engine_id=cdm_1`, and
`ready=true`; then save that base URL in **Configurações → Conexões dos motores
→ Backend individual**. Railway remains the two-or-more-engine comparator.
Visitors to GitHub Pages do not need Docker installed locally.

For an optional local smoke test of the container:

```sh
docker build -f backend/Dockerfile.cdm -t shm-cdm-1 backend
docker run --rm -p 8000:8000 shm-cdm-1
```

The source file was copied from the user's `concrete_damage_morphology_v285_native.py`
artifact; keep it in sync when the Inkscape extension changes.
