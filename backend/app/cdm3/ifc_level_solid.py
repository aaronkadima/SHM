"""Sólido de camadas de nível (CDM-4) como IfcSurfaceFeature — IFC4 e IFC 4.3.

Representa a FORMA APROXIMADA do dano para identificação visual no modelo: a altura de cada camada é
nível do potencial × espessura de camada; não é profundidade medida.

IFC4X3: PredefinedType DEFECT + IfcRelAdheresToElement.
IFC4:   PredefinedType USERDEFINED, ObjectType "DEFECT" + IfcRelAggregates (IfcRelAdheresToElement não existe).
Body / SurfaceModel: um IfcShellBasedSurfaceModel (cascas fechadas) por camada, com estilo de cor por nível.
A entrada é a mesma do gravador JavaScript (frontend/src/ifcLevelSolidWriter.js).
"""
from __future__ import annotations

from pathlib import Path
from typing import Any

import numpy as np

VIRIDIS = [(68, 1, 84), (59, 82, 139), (33, 145, 140), (94, 201, 98), (253, 231, 37)]
NOTE = ("Forma aproximada do dano para identificação visual; altura = nível do potencial × "
        "espessura da camada, não é profundidade")


class LevelSolidError(Exception):
    pass


def level_color(k: int, n: int):
    t = k / (n - 1) if n > 1 else 1.0
    x = t * (len(VIRIDIS) - 1)
    i = min(len(VIRIDIS) - 2, int(x))
    f = x - i
    a, b = VIRIDIS[i], VIRIDIS[i + 1]
    return tuple((a[j] + (b[j] - a[j]) * f) / 255 for j in range(3))


def _norm(v):
    v = np.asarray(v, float)
    n = np.linalg.norm(v)
    return v / n if n else v


def _frame(origin, ex, n):
    z = _norm(n)
    x = _norm(np.asarray(ex, float) - np.dot(ex, z) * z)
    y = np.cross(z, x)
    m = np.eye(4)
    m[:3, 0], m[:3, 1], m[:3, 2], m[:3, 3] = x, y, z, origin
    return m


def _signed(ring):
    r = np.asarray(ring, float)
    x, y = r[:, 0], r[:, 1]
    return 0.5 * float(np.sum(np.roll(x, 1) * y - x * np.roll(y, 1)))


def _length_unit_m(f) -> float:
    import ifcopenshell.util.unit as uu
    try:
        return float(uu.calculate_unit_scale(f))
    except Exception:
        return 1.0


def _body_context(f):
    for c in f.by_type("IfcGeometricRepresentationSubContext"):
        if (c.ContextIdentifier or "").lower() == "body":
            return c
    for c in f.by_type("IfcGeometricRepresentationContext"):
        if not c.is_a("IfcGeometricRepresentationSubContext"):
            return c
    raise LevelSolidError("Contexto geométrico 'Model/Body' não encontrado")


def write_level_solid(ifc_in: Path | str, payload: dict[str, Any], ifc_out: Path | str):
    import ifcopenshell
    import ifcopenshell.guid
    import ifcopenshell.util.placement as up

    f = ifcopenshell.open(str(ifc_in))
    schema = f.schema.upper()
    is43 = schema.startswith("IFC4X3")
    if not schema.startswith("IFC4"):
        raise LevelSolidError(f"Esquema {f.schema} não suportado: use IFC4 ou IFC 4.3")
    host = f.by_guid(payload["host_guid"]) if payload.get("host_guid") else None
    if host is None or not getattr(host, "ObjectPlacement", None):
        raise LevelSolidError("Elemento hospedeiro não encontrado ou sem posicionamento")
    solid, face, meta = payload["solid"], payload["face"], payload.get("meta", {})
    ctx = _body_context(f)
    oh = (f.by_type("IfcOwnerHistory") or [None])[0]
    k = 0.001 / _length_unit_m(f)  # mm → unidades do modelo
    Mh = up.get_local_placement(host.ObjectPlacement)  # unidades do modelo
    Rl = np.linalg.inv(Mh) @ _frame(np.asarray(face["origin"], float), face["ex"], face["n"])
    levels = list(solid["levels"])
    offset = float(meta.get("offsetMm", 0.5))
    cavity_in = payload.get("cavity") or None
    cavity = {int(r["id"]): r for r in (cavity_in or {}).get("regions", [])}
    cut = bool(cavity) and payload.get("voids", True) is not False
    direction = -1 if cavity or float(payload.get("direction", 1)) < 0 else 1
    relief = {} if cavity else {int(r["id"]): r for r in (payload.get("relief") or {}).get("regions", [])}
    if cavity:
        style_txt = "cavidade com vales" if cavity_in.get("style") == "relief" else "cavidade em degraus"
    else:
        style_txt = "relevo contínuo (com vales)" if relief else "camadas planas"
    dir_txt = "para fora da face" if direction > 0 else "para dentro da face"
    name, cls = meta.get("name", "Dano CDM-4"), meta.get("className", "Desplacamento")

    styles = []
    for i, t in enumerate(levels):
        r, g, b = level_color(i, len(levels))
        col = f.createIfcColourRgb(None, r, g, b)
        sh = f.createIfcSurfaceStyleShading(col, 0.15)
        styles.append(f.createIfcSurfaceStyle(f"CDM-4 nível {str(t).replace('.', ',')}", "BOTH", [sh]))

    P = lambda x, y, z: f.createIfcCartesianPoint((float(x), float(y), float(z)))
    loop = lambda pts: f.createIfcPolyLoop(pts)
    features, summary = [], []
    def face_set(P3, I, closed, orient):
        co = np.column_stack([P3[:, 0] * k, -P3[:, 1] * k, -P3[:, 2] * k])
        a_, b_, c_ = co[I[:, 0]], co[I[:, 1]], co[I[:, 2]]
        if orient == "volume":
            acc = np.einsum("ij,ij->i", a_, np.cross(b_, c_)).sum()
        else:
            acc = (np.cross(b_ - a_, c_ - a_)[:, 2]).sum()
        if acc < 0:
            I = I[:, [0, 2, 1]]
        pl = f.create_entity("IfcCartesianPointList3D", CoordList=[tuple(map(float, p)) for p in co])
        return f.create_entity("IfcTriangulatedFaceSet", Coordinates=pl, Closed=closed,
                               CoordIndex=[tuple(int(x) + 1 for x in t) for t in I])

    if cut:
        vcol = f.createIfcColourRgb(None, 0.62, 0.66, 0.68)
        void_style = f.createIfcSurfaceStyle("CDM-4 recorte", "BOTH", [f.createIfcSurfaceStyleShading(vcol, 0.0)])
    voids_out = []
    _rs = []

    def rebar_style():
        if not _rs:
            c = f.createIfcColourRgb(None, 0.48, 0.37, 0.30)
            _rs.append(f.createIfcSurfaceStyle("CDM-4 armadura exposta", "BOTH", [f.createIfcSurfaceStyleShading(c, 0.0)]))
        return _rs[0]
    regions_out = [R for R in solid["regions"] if (int(R["id"]) in cavity if cavity else (not relief or int(R["id"]) in relief))]
    for R in regions_out:
        items, rep_type = [], "SurfaceModel"
        cav = cavity.get(int(R["id"])) if cavity else None
        if cav:
            # côncava: fundo da cavidade (superfície aberta, colorida por faixa); o volume removido vai num IfcVoidingFeature
            L = cav["lining"]
            fs = face_set(np.asarray(L["positions"], float).reshape(-1, 3), np.asarray(L["indices"], int).reshape(-1, 3), False, "up")
            cl = f.create_entity("IfcColourRgbList", ColourList=[level_color(i, len(levels)) for i in range(len(levels))])
            f.create_entity("IfcIndexedColourMap", MappedTo=fs, Colours=cl, ColourIndex=[int(b) + 1 for b in L["band"]])
            f.createIfcStyledItem(fs, [styles[(len(levels) - 1) // 2]], None)
            items.append(fs)
            # armadura exposta projetada: tubos fechados no mesmo corpo (representação do dano, não um IfcReinforcingBar)
            for rb in cav.get("rebars") or []:
                bf = face_set(np.asarray(rb["positions"], float).reshape(-1, 3), np.asarray(rb["indices"], int).reshape(-1, 3), True, "volume")
                f.createIfcStyledItem(bf, [rebar_style()], None)
                items.append(bf)
            rep_type = "Tessellation"
        elif relief:
            # relevo contínuo: IfcTriangulatedFaceSet fechada, cores por faixa de nível
            M3 = relief[int(R["id"])]
            P3 = np.asarray(M3["positions"], float).reshape(-1, 3)
            co = np.column_stack([P3[:, 0] * k, -P3[:, 1] * k, direction * (P3[:, 2] + offset) * k])
            I = np.asarray(M3["indices"], int).reshape(-1, 3)
            a_, b_, c_ = co[I[:, 0]], co[I[:, 1]], co[I[:, 2]]
            if np.einsum("ij,ij->i", a_, np.cross(b_, c_)).sum() < 0:
                I = I[:, [0, 2, 1]]
            pl = f.create_entity("IfcCartesianPointList3D", CoordList=[tuple(map(float, p)) for p in co])
            fs = f.create_entity("IfcTriangulatedFaceSet", Coordinates=pl, Closed=True,
                                 CoordIndex=[tuple(int(x) + 1 for x in t) for t in I])
            cl = f.create_entity("IfcColourRgbList", ColourList=[level_color(i, len(levels)) for i in range(len(levels))])
            f.create_entity("IfcIndexedColourMap", MappedTo=fs, Colours=cl, ColourIndex=[int(b) + 1 for b in M3["band"]])
            f.createIfcStyledItem(fs, [styles[(len(levels) - 1) // 2]], None)
            items.append(fs)
            rep_type = "Tessellation"
        else:
          for L in R["layers"]:
            shells = []
            if direction > 0:
                z0, z1 = (L["z0"] + offset) * k, (L["z1"] + offset) * k
            else:
                z0, z1 = -(L["z1"] + offset) * k, -(L["z0"] + offset) * k
            for poly in L["polys"]:
                outer = [(u * k, -v * k) for u, v in poly["outer"]]
                if _signed(outer) < 0:
                    outer.reverse()
                holes = []
                for h in poly.get("holes", []):
                    hh = [(u * k, -v * k) for u, v in h]
                    if _signed(hh) > 0:
                        hh.reverse()
                    holes.append(hh)
                pts = [([P(x, y, z0) for x, y in r], [P(x, y, z1) for x, y in r]) for r in [outer, *holes]]
                faces = [
                    f.createIfcFace([f.createIfcFaceOuterBound(loop(pts[0][1]), True),
                                     *[f.createIfcFaceBound(loop(t), True) for _, t in pts[1:]]]),
                    f.createIfcFace([f.createIfcFaceOuterBound(loop(pts[0][0][::-1]), True),
                                     *[f.createIfcFaceBound(loop(b[::-1]), True) for b, _ in pts[1:]]]),
                ]
                for b, t in pts:
                    for i in range(len(b)):
                        j = (i + 1) % len(b)
                        faces.append(f.createIfcFace([f.createIfcFaceOuterBound(loop([b[i], b[j], t[j], t[i]]), True)]))
                shells.append(f.createIfcClosedShell(faces))
            sbsm = f.createIfcShellBasedSurfaceModel(shells)
            items.append(sbsm)
            f.createIfcStyledItem(sbsm, [styles[levels.index(L["level"])]], None)
        rep = f.createIfcShapeRepresentation(ctx, "Body", rep_type, items)
        pds = f.createIfcProductDefinitionShape(None, None, [rep])
        ax = f.createIfcAxis2Placement3D(P(*Rl[:3, 3]), f.createIfcDirection(tuple(map(float, Rl[:3, 2]))),
                                         f.createIfcDirection(tuple(map(float, Rl[:3, 0]))))
        lp = f.createIfcLocalPlacement(host.ObjectPlacement, ax)
        shape_txt = style_txt if cavity else ("relevo contínuo" if relief else f"{len(R['layers'])} camadas de nível")
        desc = (f"{cls}: forma aproximada ({shape_txt}, {dir_txt}; altura proporcional ao potencial, "
                f"{solid['layerMm']} mm por nível; não é profundidade)")
        sf = f.create_entity("IfcSurfaceFeature", GlobalId=ifcopenshell.guid.new(), OwnerHistory=oh,
                             Name=f"{name} R{R['id']}", Description=desc, ObjectType=None if is43 else "DEFECT",
                             ObjectPlacement=lp, Representation=pds,
                             PredefinedType="DEFECT" if is43 else "USERDEFINED")
        features.append(sf)
        base = (R.get("areaByLevel") or [{"area_mm2": 0}])[0]["area_mm2"]
        props = [
            ("Representacao", f.createIfcText(NOTE)),
            ("Motor", f.createIfcLabel("CDM-4 (random walker, fluxo por evidência)")),
            ("Classe", f.createIfcLabel(cls)),
            ("Estilo", f.createIfcLabel(style_txt)),
            ("Sentido", f.createIfcLabel(dir_txt)),
            *([("Armadura", f.createIfcText(
                f"{len(cav['rebars'])} trecho(s) de armadura exposta projetado(s) · Ø "
                + "; ".join(str(d).replace(".", ",") for d in sorted({b["d"] for b in cav["rebars"]})) + " mm ("
                + ("estimado pela largura detectada" if (cavity_in.get("rebar") or {}).get("diameter", "auto") == "auto" else "informado") + ") · "
                + (f"cobrimento {(cavity_in.get('rebar') or {}).get('coverMm')} mm" if (cavity_in.get("rebar") or {}).get("mode") == "cover" else "sobre o fundo da cavidade")
                + " · posição aproximada, a partir da máscara de armadura exposta"))] if cav and cav.get("rebars") else []),
            *([("Recorte", f.createIfcLabel(
                "IfcVoidingFeature + IfcRelVoidsElement (geometria do elemento inalterada; apagar o recorte restaura a vista original)"
                if cut else "sem recorte"))] if cavity else []),
            ("Niveis", f.createIfcLabel("; ".join(str(v).replace(".", ",") for v in levels))),
            ("EspessuraCamada_mm", f.createIfcReal(float(solid["layerMm"]))),
            ("AreaNivelBase_m2", f.createIfcReal(round(base / 1e6, 6))),
            *[(f"Area_u{str(a['level']).replace('.', '_')}_m2", f.createIfcReal(round(a["area_mm2"] / 1e6, 6)))
              for a in R.get("areaByLevel", [])],
            *[(lbl, f.createIfcLabel(str(meta[key]))) for key, lbl in
              (("image", "Imagem"), ("scale", "Escala"), ("date", "DataInspecao")) if meta.get(key)],
        ]
        ps = f.createIfcPropertySet(ifcopenshell.guid.new(), oh, "CDM_DamageShape", None,
                                    [f.createIfcPropertySingleValue(n, None, v, None) for n, v in props])
        vf = None
        if cut:
            # recorte: degraus extrudados (perfil com furos), da tampa 1 mm fora da face até o fundo de cada degrau
            cap = float(cavity_in.get("capMm", 1))
            dn = f.createIfcDirection((0.0, 0.0, -1.0))
            curve = lambda r: f.createIfcPolyline([f.createIfcCartesianPoint((float(u * k), float(-v * k))) for u, v in [*r, r[0]]])
            solids = []
            for st in cav["steps"]:
                top = float(st.get("topMm", -cap))
                pos = f.createIfcAxis2Placement3D(P(0, 0, -top * k), None, None)
                for pg in st["polys"]:
                    if len(pg["outer"]) < 3:
                        continue
                    if pg.get("holes"):
                        prof = f.createIfcArbitraryProfileDefWithVoids("AREA", None, curve(pg["outer"]), [curve(h) for h in pg["holes"]])
                    else:
                        prof = f.createIfcArbitraryClosedProfileDef("AREA", None, curve(pg["outer"]))
                    x = f.createIfcExtrudedAreaSolid(prof, pos, dn, float((st["depthMm"] - top) * k))
                    f.createIfcStyledItem(x, [void_style], None)
                    solids.append(x)
            vrep = f.createIfcShapeRepresentation(ctx, "Body", "SweptSolid", solids)
            vf = f.create_entity("IfcVoidingFeature", GlobalId=ifcopenshell.guid.new(), OwnerHistory=oh,
                                 Name=f"Recorte {name} R{R['id']}", ObjectType="DEFECT",
                                 Description=f"{cls}: volume removido só para visualização da forma aproximada do dano (não é profundidade medida)",
                                 ObjectPlacement=f.createIfcLocalPlacement(host.ObjectPlacement, ax),
                                 Representation=f.createIfcProductDefinitionShape(None, None, [vrep]), PredefinedType="USERDEFINED")
            f.createIfcRelVoidsElement(ifcopenshell.guid.new(), oh, "CDM-4 recorte", None, host, vf)
            voids_out.append(vf)
        f.createIfcRelDefinesByProperties(ifcopenshell.guid.new(), oh, None, None, [x for x in (sf, vf) if x], ps)
        summary.append({"region": R["id"], "global_id": sf.GlobalId, "layers": len(R["layers"]), "area_m2": base / 1e6,
                        "void": vf.GlobalId if vf else None})
    if features:
        if is43:
            f.create_entity("IfcRelAdheresToElement", GlobalId=ifcopenshell.guid.new(), OwnerHistory=oh,
                            Name="CDM-4 danos", RelatingElement=host, RelatedSurfaceFeatures=features)
        elif cut:
            # IFC4 com recorte: cada fundo é agregado ao seu recorte (agregá-lo ao elemento faria o web-ifc recortar o fundo também)
            for sf_, vf_ in zip(features, voids_out):
                f.createIfcRelAggregates(ifcopenshell.guid.new(), oh, "CDM-4 dano", None, vf_, [sf_])
        else:
            f.createIfcRelAggregates(ifcopenshell.guid.new(), oh, "CDM-4 danos", None, host, features)
    Path(ifc_out).parent.mkdir(parents=True, exist_ok=True)
    f.write(str(ifc_out))
    return {"schema": f.schema, "relation": "IfcRelAdheresToElement" if is43 else "IfcRelAggregates",
            "features": summary, "voids": len(voids_out)}
