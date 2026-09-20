from app.engines.catalog import CATALOG


def test_catalog_ids_are_unique():
    ids = [x["id"] for x in CATALOG]
    assert len(ids) == len(set(ids))


def test_every_engine_declares_adapter_and_task():
    for spec in CATALOG:
        assert spec["adapter"]
        assert spec["task"]
        assert "requires_weights" in spec
