"""Tests for sorger-mittagessen allergen partition script."""

import json
import subprocess
import sys
from pathlib import Path

SCRIPT = (
    Path(__file__).resolve().parents[2]
    / "skills"
    / "productivity"
    / "sorger-mittagessen"
    / "scripts"
    / "partition_allergens.py"
)


def _run(dishes, exclude=None):
    payload = {"dishes": dishes}
    if exclude is not None:
        payload["exclude"] = exclude
    proc = subprocess.run(
        [sys.executable, str(SCRIPT)],
        input=json.dumps(payload),
        capture_output=True,
        text=True,
        check=True,
    )
    return json.loads(proc.stdout)


def test_g_dishes_go_to_excluded_not_eligible():
    """Regression: agent put Moussaka and Paprikasuppe (G,O) in eligible_dishes."""
    dishes = [
        {"name": "Süßkartoffel-Moussaka mit Paradeisersauce und Gurkenrahmsalat", "allergens": ["G", "O"]},
        {"name": "Kunterbunter Salat", "allergens": []},
        {"name": "Chili con Carne (im Glas ca. 660g)", "allergens": ["O"]},
        {"name": "Paprikasuppe mit Chili", "allergens": ["G", "O"]},
        {"name": "Brokkolicremesuppe", "allergens": ["G", "O"]},
        {"name": "Minestrone Fregola Sarda vegan", "allergens": ["A", "L", "O"]},
    ]
    out = _run(dishes)
    eligible_names = {d["name"] for d in out["eligible_dishes"]}
    excluded_names = {d["name"] for d in out["excluded_dishes"]}

    assert "Kunterbunter Salat" in eligible_names
    assert "Chili con Carne (im Glas ca. 660g)" in eligible_names
    assert "Süßkartoffel-Moussaka mit Paradeisersauce und Gurkenrahmsalat" in excluded_names
    assert "Paprikasuppe mit Chili" in excluded_names
    assert "Brokkolicremesuppe" in excluded_names
    assert "Minestrone Fregola Sarda vegan" in excluded_names

    for row in out["eligible_dishes"]:
        assert "A" not in row["allergens"]
        assert "G" not in row["allergens"]
        assert "option" in row

    for row in out["excluded_dishes"]:
        assert set(row["allergens"]) & {"A", "G"}
        assert "G" in row["reason"] or "A" in row["reason"]


def test_o_only_stays_eligible():
    out = _run([{"name": "Chili con Carne", "allergens": ["O"]}])
    assert len(out["eligible_dishes"]) == 1
    assert out["eligible_dishes"][0]["option"] == 1
    assert out["excluded_dishes"] == []
