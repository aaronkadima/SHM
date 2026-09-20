from __future__ import annotations

TAXONOMY = [
    "crack",
    "spalling",
    "delamination",
    "corrosion",
    "exposed_rebar",
    "efflorescence",
    "moisture",
    "honeycombing",
    "scaling",
    "abrasion",
    "joint_damage",
    "bearing_damage",
    "other",
]

PROMPT_LABELS = [
    "concrete crack",
    "concrete spalling",
    "concrete delamination",
    "rust corrosion",
    "exposed reinforcing steel",
    "efflorescence",
    "water leakage moisture stain",
    "concrete honeycombing",
    "concrete scaling",
    "concrete abrasion erosion",
    "damaged expansion joint",
    "damaged bridge bearing",
]

ALIASES = {
    "fissure": "crack",
    "fissura": "crack",
    "cracks": "crack",
    "spall": "spalling",
    "rust": "corrosion",
    "rebar": "exposed_rebar",
    "exposed reinforcing steel": "exposed_rebar",
    "reinforcement exposure": "exposed_rebar",
    "water leakage": "moisture",
    "water leakage moisture stain": "moisture",
    "concrete crack": "crack",
    "concrete spalling": "spalling",
    "concrete delamination": "delamination",
    "rust corrosion": "corrosion",
    "efflorescence": "efflorescence",
    "concrete honeycombing": "honeycombing",
    "concrete scaling": "scaling",
    "concrete abrasion erosion": "abrasion",
    "damaged expansion joint": "joint_damage",
    "damaged bridge bearing": "bearing_damage",
}


def normalize_label(label: str) -> str:
    key = label.strip().lower().replace("-", " ").replace("_", " ")
    if key in ALIASES:
        return ALIASES[key]
    compact = key.replace(" ", "_")
    return compact if compact in TAXONOMY else label.strip()
