"""CDM-3 experimental 3D/spatial inspection engine.

The package is intentionally import-light. Heavy optional dependencies
(ifcopenshell, laspy, scipy, trimesh, svgwrite) are imported only inside the
submodules/endpoints that need them so the regular SHM backend remains usable.
"""

CDM3_VERSION = "3.0.0-dev"
