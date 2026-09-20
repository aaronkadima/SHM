from PIL import Image, ImageDraw

from app.engines.catalog import CATALOG
from app.engines.morphology import MorphologyEngine


def test_morphology_runs_on_synthetic_crack():
    image = Image.new("RGB", (256, 256), "white")
    draw = ImageDraw.Draw(image)
    draw.line((20, 30, 230, 210), fill="black", width=2)

    spec = next(x for x in CATALOG if x["id"] == "opencv-morphology")
    result = MorphologyEngine(spec).predict(image, threshold=0.1)

    assert result.state == "ok"
    assert result.overlay_base64 is not None
    assert result.affected_area_percent is not None
    assert result.affected_area_percent >= 0.0
