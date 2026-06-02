#!/usr/bin/env python3
"""Partition Sorger menu dishes into eligible vs excluded by allergen policy.

Reads JSON from stdin:
  {"dishes": [{"name": "...", "allergens": ["G", "O"]}, ...], "exclude": ["A", "G"]}

Writes JSON to stdout:
  {"eligible_dishes": [...], "excluded_dishes": [...], "allergen_policy": {"exclude": [...]}}

The agent must run this after parsing Allergene: lines from the browser — do not
hand-classify into eligible_dishes (LLMs often leave G dishes in eligible).
"""
from __future__ import annotations

import json
import os
import sys
from typing import Any


def _normalize_codes(allergens: Any) -> list[str]:
    if not allergens:
        return []
    if isinstance(allergens, str):
        raw = allergens.replace(",", " ").split()
    else:
        raw = list(allergens)
    codes: list[str] = []
    for item in raw:
        s = str(item).strip().upper()
        if len(s) == 1 and s.isalpha():
            codes.append(s)
    return sorted(set(codes))


def _blocked_reason(blocked: set[str]) -> str:
    parts = []
    if "A" in blocked:
        parts.append("A")
    if "G" in blocked:
        parts.append("G")
    if not parts:
        return "contains excluded allergen"
    if len(parts) == 1:
        return f"contains {parts[0]}"
    return "contains A and G"


def partition_dishes(
    dishes: list[dict[str, Any]],
    exclude: list[str] | None = None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    exclude_set = {c.strip().upper() for c in (exclude or ["A", "G"]) if c.strip()}
    eligible: list[dict[str, Any]] = []
    excluded: list[dict[str, Any]] = []

    for dish in dishes:
        name = (dish.get("name") or "").strip()
        if not name:
            continue
        codes = _normalize_codes(dish.get("allergens"))
        blocked = exclude_set & set(codes)
        row = {"name": name, "allergens": codes}
        if blocked:
            excluded.append({**row, "reason": _blocked_reason(blocked)})
        else:
            eligible.append(row)

    for i, row in enumerate(eligible, start=1):
        row["option"] = i

    return eligible, excluded


def main() -> int:
    try:
        data = json.load(sys.stdin)
    except json.JSONDecodeError as exc:
        print(json.dumps({"error": f"invalid JSON: {exc}"}), file=sys.stderr)
        return 1

    dishes = data.get("dishes") or data.get("all_dishes") or []
    if not isinstance(dishes, list):
        print(json.dumps({"error": "dishes must be a list"}), file=sys.stderr)
        return 1

    exclude = data.get("exclude")
    if exclude is None:
        env = os.environ.get("SORGER_EXCLUDE_ALLERGENS", "A,G")
        exclude = [c.strip() for c in env.split(",") if c.strip()]

    eligible, excluded = partition_dishes(dishes, exclude=exclude)
    out = {
        "eligible_dishes": eligible,
        "excluded_dishes": excluded,
        "allergen_policy": {"exclude": sorted({c.upper() for c in exclude})},
    }
    json.dump(out, sys.stdout, ensure_ascii=False, indent=2)
    print()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
