"""Sólido de camadas de nível (CDM-4) em IFC4 e IFC 4.3: validação de esquema, relação e posição sobre a face."""
import json, sys, tempfile
from pathlib import Path
import numpy as np
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import ifcopenshell, ifcopenshell.api, ifcopenshell.validate, ifcopenshell.geom
from app.cdm3.ifc_level_solid import write_level_solid


def pier(schema):
    try:
        f = ifcopenshell.api.run("project.create_file", version=schema)
    except Exception:
        f = ifcopenshell.file(schema=schema)
    proj = ifcopenshell.api.run("root.create_entity", f, ifc_class="IfcProject", name="P")
    ifcopenshell.api.run("unit.assign_unit", f, length={"is_metric": True, "raw": "MILLIMETERS"})
    model = ifcopenshell.api.run("context.add_context", f, context_type="Model")
    body = ifcopenshell.api.run("context.add_context", f, context_type="Model", context_identifier="Body",
                                target_view="MODEL_VIEW", parent=model)
    site = ifcopenshell.api.run("root.create_entity", f, ifc_class="IfcSite", name="S")
    ifcopenshell.api.run("aggregate.assign_object", f, relating_object=proj, products=[site])
    col = ifcopenshell.api.run("root.create_entity", f, ifc_class="IfcColumn", name="Pilar")
    ifcopenshell.api.run("spatial.assign_container", f, relating_structure=site, products=[col])
    a = np.pi / 6
    m = np.eye(4); m[:2, :2] = [[np.cos(a), -np.sin(a)], [np.sin(a), np.cos(a)]]; m[:3, 3] = [100000, 50000, 2000]
    ifcopenshell.api.run("geometry.edit_object_placement", f, product=col, matrix=m, is_si=False)
    prof = f.createIfcRectangleProfileDef("AREA", None, f.createIfcAxis2Placement2D(f.createIfcCartesianPoint((0.0, 0.0))), 1200.0, 800.0)
    rep = ifcopenshell.api.run("geometry.add_profile_representation", f, context=body, profile=prof, depth=5.0)
    ifcopenshell.api.run("geometry.assign_representation", f, product=col, representation=rep)
    return f, col, a


def square_solid():
    # duas camadas: quadrado 300×300 mm com furo de 100×100 no nível 0,2; quadrado 150×150 no nível 0,6
    ring = lambda x0, y0, s: [[x0, y0], [x0 + s, y0], [x0 + s, y0 + s], [x0, y0 + s]]
    return {"levels": [0.2, 0.6], "layerMm": 10, "regions": [{"id": 1, "layers": [
        {"level": 0.2, "z0": 0, "z1": 10, "polys": [{"outer": ring(450, 1000, 300), "holes": [ring(470, 1020, 60)], "area": 86400}]},
        {"level": 0.6, "z0": 10, "z1": 20, "polys": [{"outer": ring(525, 1075, 150), "holes": [], "area": 22500}]}],
        "areaByLevel": [{"level": 0.2, "area_mm2": 86400}, {"level": 0.6, "area_mm2": 22500}]}]}


ok = True
for schema in ("IFC4", "IFC4X3"):
    f, col, a = pier(schema)
    rot = lambda x, y: (x * np.cos(a) - y * np.sin(a), x * np.sin(a) + y * np.cos(a))
    o = rot(600, 400)
    face = {"origin": [100000 + o[0], 50000 + o[1], 7000], "ex": [*rot(-1, 0), 0], "n": [*rot(0, 1), 0]}
    with tempfile.TemporaryDirectory() as td:
        src, out = Path(td) / "in.ifc", Path(td) / "out.ifc"
        f.write(str(src))
        info = write_level_solid(src, {"host_guid": col.GlobalId, "face": face, "solid": square_solid(), "meta": {}}, out)
        g = ifcopenshell.open(str(out))
        lg = ifcopenshell.validate.json_logger(); ifcopenshell.validate.validate(g, lg)
        sf = g.by_type("IfcSurfaceFeature")[0]
        rel = (sf.AdheresToElement[0].RelatingElement if schema == "IFC4X3" else sf.Decomposes[0].RelatingObject)
        s = ifcopenshell.geom.settings()
        s.set(s.USE_WORLD_COORDS, True) if hasattr(s, "USE_WORLD_COORDS") else s.set("use-world-coords", True)
        shape = ifcopenshell.geom.create_shape(s, sf)  # manter a referência: no 0.8.x os vértices apontam para ela
        v = np.array(shape.geometry.verts, dtype=float).reshape(-1, 3) - [100, 50, 2]
        lx = np.cos(a) * v[:, 0] + np.sin(a) * v[:, 1]; ly = -np.sin(a) * v[:, 0] + np.cos(a) * v[:, 1]
        # u = 450..750 mm a partir da aresta x=+0,6 → x local = 0,6−u; v=1000..1300 a partir do topo → z = 5−v
        checks = {
            "validação sem erros": not lg.statements,
            "tipo": (sf.PredefinedType, sf.ObjectType) == (("DEFECT", None) if schema == "IFC4X3" else ("USERDEFINED", "DEFECT")),
            "hospedeiro": rel == g.by_guid(col.GlobalId),
            "sem contenção espacial": not sf.ContainedInStructure if hasattr(sf, "ContainedInStructure") else True,
            "x local": np.allclose([lx.min(), lx.max()], [-0.15, 0.15], atol=1e-6),
            "z": np.allclose([v[:, 2].min(), v[:, 2].max()], [3.7, 4.0], atol=1e-6),
            "normal (face+0,5..+20,5 mm)": np.allclose([ly.min(), ly.max()], [0.4005, 0.4205], atol=1e-6),
        }
        for k, val in checks.items():
            print(schema, k, "ok" if val else "FALHOU"); ok &= bool(val)
# relevo contínuo (IfcTriangulatedFaceSet) e sentido para dentro, nos dois esquemas
pyr = {"id": 1, "positions": [450, 1000, 0, 750, 1000, 0, 750, 1300, 0, 450, 1300, 0, 600, 1150, 20],
       "indices": [0, 1, 4, 1, 2, 4, 2, 3, 4, 3, 0, 4, 0, 3, 2, 0, 2, 1], "band": [1, 1, 1, 1, 0, 0]}
for schema in ("IFC4", "IFC4X3"):
    f, col, a = pier(schema)
    rot = lambda x, y: (x * np.cos(a) - y * np.sin(a), x * np.sin(a) + y * np.cos(a))
    o = rot(600, 400)
    face = {"origin": [100000 + o[0], 50000 + o[1], 7000], "ex": [*rot(-1, 0), 0], "n": [*rot(0, 1), 0]}
    for direction, rng in ((1, [0.4005, 0.4205]), (-1, [0.3795, 0.3995])):
        with tempfile.TemporaryDirectory() as td:
            src, out = Path(td) / "in.ifc", Path(td) / "out.ifc"
            f.write(str(src))
            write_level_solid(src, {"host_guid": col.GlobalId, "face": face, "solid": square_solid(), "relief": {"regions": [pyr]},
                                    "direction": direction, "meta": {}}, out)
            g = ifcopenshell.open(str(out))
            lg = ifcopenshell.validate.json_logger(); ifcopenshell.validate.validate(g, lg)
            sf = g.by_type("IfcSurfaceFeature")[0]
            s = ifcopenshell.geom.settings()
            s.set(s.USE_WORLD_COORDS, True) if hasattr(s, "USE_WORLD_COORDS") else s.set("use-world-coords", True)
            shape = ifcopenshell.geom.create_shape(s, sf)
            v = np.array(shape.geometry.verts, dtype=float).reshape(-1, 3) - [100, 50, 2]
            ly = -np.sin(a) * v[:, 0] + np.cos(a) * v[:, 1]
            checks = {f"relevo {direction:+d} sem erros": not lg.statements,
                      f"relevo {direction:+d} tipo Tessellation": sf.Representation.Representations[0].RepresentationType == "Tessellation",
                      f"relevo {direction:+d} cores por faixa": len(g.by_type("IfcIndexedColourMap")) == 1,
                      f"relevo {direction:+d} normal da face": np.allclose([ly.min(), ly.max()], rng, atol=1e-6)}
            for k, val in checks.items():
                print(schema, k, "ok" if val else "FALHOU"); ok &= bool(val)

# projeção côncava: fundo da cavidade + recorte (IfcVoidingFeature + IfcRelVoidsElement), elemento inalterado
def vol(shape):
    v = np.array(shape.geometry.verts, dtype=float).reshape(-1, 3); fc = np.array(shape.geometry.faces).reshape(-1, 3)
    return abs(np.einsum("ij,ij->i", v[fc[:, 0]], np.cross(v[fc[:, 1]], v[fc[:, 2]])).sum() / 6)
sq = lambda x, y, s: [[x, y], [x + s, y], [x + s, y + s], [x, y + s]]
cav = {"style": "relief", "capMm": 1, "regions": [{"id": 1,
       "lining": {"positions": [450, 1000, 0, 750, 1000, 0, 750, 1300, 0, 450, 1300, 0, 600, 1150, 20],
                  "indices": [0, 1, 4, 1, 2, 4, 2, 3, 4, 3, 0, 4], "band": [1, 1, 1, 1]},
       "steps": [{"level": 0.2, "topMm": -1, "depthMm": 11.5, "polys": [{"outer": sq(445, 995, 310), "holes": []}]},
                 {"level": 0.6, "topMm": 11, "depthMm": 21.5, "polys": [{"outer": sq(520, 1070, 160), "holes": []}]}]}]}
for schema in ("IFC4", "IFC4X3"):
    f, col, a = pier(schema)
    rot = lambda x, y: (x * np.cos(a) - y * np.sin(a), x * np.sin(a) + y * np.cos(a))
    o = rot(600, 400)
    face = {"origin": [100000 + o[0], 50000 + o[1], 7000], "ex": [*rot(-1, 0), 0], "n": [*rot(0, 1), 0]}
    for voids in (True, False):
        with tempfile.TemporaryDirectory() as td:
            src, out = Path(td) / "in.ifc", Path(td) / "out.ifc"
            f.write(str(src))
            host_before = ifcopenshell.open(str(src)).by_guid(col.GlobalId).Representation.Representations[0].Items[0].Depth
            info = write_level_solid(src, {"host_guid": col.GlobalId, "face": face, "solid": square_solid(), "cavity": cav, "voids": voids, "meta": {}}, out)
            g = ifcopenshell.open(str(out))
            lg = ifcopenshell.validate.json_logger(); ifcopenshell.validate.validate(g, lg)
            s = ifcopenshell.geom.settings()
            s.set(s.USE_WORLD_COORDS, True) if hasattr(s, "USE_WORLD_COORDS") else s.set("use-world-coords", True)
            host = g.by_guid(col.GlobalId)
            shape = ifcopenshell.geom.create_shape(s, host)
            removed = 0.31 * 0.31 * 0.0115 + 0.16 * 0.16 * 0.0215 - 0.16 * 0.16 * 0.0115  # degraus dentro do pilar (m³)
            sf = g.by_type("IfcSurfaceFeature")[0]
            lining = ifcopenshell.geom.create_shape(s, sf)
            tag = "recorte" if voids else "sem recorte"
            checks = {f"{tag}: sem erros": not lg.statements,
                      f"{tag}: elemento com a mesma geometria": host.Representation.Representations[0].Items[0].Depth == host_before,
                      f"{tag}: recortes": info["voids"] == (1 if voids else 0) and len(g.by_type("IfcRelVoidsElement")) == (1 if voids else 0),
                      f"{tag}: volume do pilar": abs(vol(shape) - (4.8 - (removed if voids else 0))) < 2e-4,
                      f"{tag}: fundo intacto": len(lining.geometry.faces) // 3 == 4}
            if voids and schema == "IFC4":
                checks[f"{tag}: IFC4 fundo agregado ao recorte"] = sf.Decomposes[0].RelatingObject.is_a("IfcVoidingFeature")
            for kk, val in checks.items():
                print(schema, kk, "ok" if val else "FALHOU"); ok &= bool(val)

# armadura exposta projetada na cavidade: tubo fechado no corpo da característica + propriedade "Armadura"
def tube(p0, p1, d, n=8):
    p0, p1 = np.array(p0, float), np.array(p1, float); t = (p1 - p0) / np.linalg.norm(p1 - p0)
    a = np.cross(t, [0, 0, 1.0]); a /= np.linalg.norm(a); b = np.cross(t, a); r = d / 2
    ring = lambda c: [c + r * (np.cos(2 * np.pi * j / n) * a + np.sin(2 * np.pi * j / n) * b) for j in range(n)]
    P = ring(p0) + ring(p1) + [p0, p1]; I = []
    for j in range(n):
        k = (j + 1) % n; I += [j, k, n + k, j, n + k, n + j, 2 * n, k, j, 2 * n + 1, n + j, n + k]
    return {"positions": [float(x) for q in P for x in q], "indices": I, "d": d}
cav_rb = {**cav, "rebar": {"diameter": 12.5, "mode": "cover", "coverMm": 10},
          "regions": [{**cav["regions"][0], "rebars": [tube([480, 1150, 16.25], [720, 1150, 16.25], 12.5)]}]}
f, col, a = pier("IFC4X3")
rot = lambda x, y: (x * np.cos(a) - y * np.sin(a), x * np.sin(a) + y * np.cos(a)); o = rot(600, 400)
face = {"origin": [100000 + o[0], 50000 + o[1], 7000], "ex": [*rot(-1, 0), 0], "n": [*rot(0, 1), 0]}
with tempfile.TemporaryDirectory() as td:
    src, out = Path(td) / "in.ifc", Path(td) / "out.ifc"; f.write(str(src))
    write_level_solid(src, {"host_guid": col.GlobalId, "face": face, "solid": square_solid(), "cavity": cav_rb, "meta": {}}, out)
    g = ifcopenshell.open(str(out)); lg = ifcopenshell.validate.json_logger(); ifcopenshell.validate.validate(g, lg)
    sf = g.by_type("IfcSurfaceFeature")[0]
    props = {p.Name: p.NominalValue.wrappedValue for r in sf.IsDefinedBy for p in r.RelatingPropertyDefinition.HasProperties}
    checks = {"armadura: sem erros": not lg.statements, "armadura: 2 itens (fundo + barra)": len(sf.Representation.Representations[0].Items) == 2,
              "armadura: propriedade": "12,5 mm (informado)" in props.get("Armadura", "") and "cobrimento 10 mm" in props.get("Armadura", ""),
              "armadura: sem IfcReinforcingBar": not g.by_type("IfcReinforcingBar")}
    for kk, val in checks.items():
        print("IFC4X3", kk, "ok" if val else "FALHOU"); ok &= bool(val)

# modo sem importação: placa de referência gerada pelo navegador (ifcReferenceHost.js) + sólido gravado pelo backend
for fx in ("host_IFC4.ifc", "host_IFC4X3.ifc"):
    src = Path(__file__).parent / "fixtures" / fx
    h = ifcopenshell.open(str(src))
    host = h.by_type("IfcBuildingElementProxy")[0]
    face = {"origin": [0, 0, 900.0], "ex": [1, 0, 0], "n": [0, -1, 0]}
    with tempfile.TemporaryDirectory() as td:
        out = Path(td) / "out.ifc"
        write_level_solid(src, {"host_guid": host.GlobalId, "face": face, "solid": square_solid(), "meta": {}}, out)
        g = ifcopenshell.open(str(out))
        lg = ifcopenshell.validate.json_logger(); ifcopenshell.validate.validate(g, lg)
        s = ifcopenshell.geom.settings()
        s.set(s.USE_WORLD_COORDS, True) if hasattr(s, "USE_WORLD_COORDS") else s.set("use-world-coords", True)
        shape = ifcopenshell.geom.create_shape(s, g.by_type("IfcSurfaceFeature")[0])
        v = np.array(shape.geometry.verts, dtype=float).reshape(-1, 3)
        checks = {"validação sem erros": not lg.statements,
                  "x (u = 450..750 mm)": np.allclose([v[:, 0].min(), v[:, 0].max()], [0.45, 0.75], atol=1e-6),
                  "z (900 − v)": np.allclose([v[:, 2].min(), v[:, 2].max()], [-0.4, -0.1], atol=1e-6),
                  "à frente da placa": np.allclose([v[:, 1].min(), v[:, 1].max()], [-0.0205, -0.0005], atol=1e-6)}
        for k, val in checks.items():
            print(fx, k, "ok" if val else "FALHOU"); ok &= bool(val)
sys.exit(0 if ok else 1)
