#!/usr/bin/env python3
"""
Compare two Allure TestOps OpenAPI specifications and produce a
diff report focused on the endpoints that the MCP server implements.

USAGE:
  python3 scripts/compare-api-versions.py \
    docs/versions/allure_api_docs_26_2_1_5.json \
    docs/versions/allure_api_docs_NEW.json \
    endpoints_impl.json

Outputs a JSON report:
  - added:     new endpoints in new spec (that overlap implemented modules)
  - removed:   endpoints gone from new spec (that were implemented)
  - changed:   endpoints where method/params differ
  - unchanged: endpoints unchanged between versions

The report drives the MCP server update: each "changed" or "removed"
entry points to the source files that need editing.
"""

import json
import sys
from collections import defaultdict

# ---------------------------------------------------------------------------
# Endpoint → module → source file mapping
# ---------------------------------------------------------------------------
MODULE_MAP = {
    "analytic":     ("src/api/analytic.ts",     "src/tools/analytic.ts"),
    "dashboards":   ("src/api/dashboards.ts",   "src/tools/dashboards.ts"),
    "defects":      ("src/api/defects.ts",      "src/tools/defects.ts"),
    "environments": ("src/api/environments.ts", "src/tools/environments.ts"),
    "launches":     ("src/api/launches.ts",     "src/tools/launches.ts"),
    "shared-steps": ("src/api/shared-steps.ts", "src/tools/shared-steps.ts"),
    "test-cases":   ("src/api/test-cases.ts",   "src/tools/test-cases.ts"),
    "test-plans":   ("src/api/test-plans.ts",   "src/tools/test-plans.ts"),
    "test-results": ("src/api/test-results.ts", "src/tools/test-results.ts"),
}

ROUTE_TO_MODULE = [
    ("/api/analytic/",       "analytic"),
    ("/api/dashboard",       "dashboards"),
    ("/api/widget/",         "dashboards"),
    ("/api/defect",          "defects"),
    ("/api/evschema",        "environments"),
    ("/api/evv",             "environments"),
    ("/api/ev/",             "environments"),
    ("/api/ev?",             "environments"),
    ("/api/launch",          "launches"),
    ("/api/sharedstep",      "shared-steps"),
    ("/api/testcase/step",   "test-cases"),
    ("/api/testcase/attach", "test-cases"),
    ("/api/testcase/__",     "test-cases"),
    ("/api/testcase/",       "test-cases"),
    ("/api/testcase?",       "test-cases"),
    ("/api/testcase",        "test-cases"),
    ("/api/v2/test-case",    "test-cases"),
    ("/api/project/",        "test-cases"),  # /cf /cfv → custom fields
    ("/api/testplan",        "test-plans"),
    ("/api/testresult/defect/match", "test-results"),
    ("/api/testresult/attach",       "test-results"),
    ("/api/testresult/__",           "test-results"),
    ("/api/testresult/",             "test-results"),
    ("/api/testresult?",             "test-results"),
    ("/api/testresult",             "test-results"),
]


def classify_endpoint(path: str) -> str | None:
    """Return module name for a path, or None if not implemented."""
    for prefix, mod in ROUTE_TO_MODULE:
        if prefix in path:
            return mod
    return None


def extract_endpoints(openapi_spec: dict) -> dict[str, dict]:
    """Extract all endpoints from an OpenAPI spec as {METHOD PATH: spec}."""
    eps = {}
    for path, methods in openapi_spec.get("paths", {}).items():
        for method in methods:
            if method in ("get", "post", "put", "patch", "delete", "options", "head"):
                key = f"{method.upper()} {path}"
                details = methods[method]
                eps[key] = {
                    "path": path,
                    "method": method.upper(),
                    "summary": details.get("summary", ""),
                    "operationId": details.get("operationId", ""),
                    "parameters": details.get("parameters", []),
                    "requestBody": "requestBody" in details,
                }
    return eps


def normalize_parameters(params: list) -> list[dict]:
    """Extract essential parameter info for comparison."""
    return [
        {"name": p.get("name", ""), "in": p.get("in", ""), "required": p.get("required", False)}
        for p in params
    ]


def compare_endpoints(
    old_eps: dict[str, dict], new_eps: dict[str, dict], watched_keys: set[str]
) -> dict:
    """Compare two endpoint maps, scoped to watched_keys from the old spec."""

    added = {}
    removed = {}
    changed = {}
    unchanged = {}

    for key in watched_keys:
        if key not in old_eps:
            continue
        old = old_eps[key]
        mod = classify_endpoint(old["path"])
        if key not in new_eps:
            removed[key] = {
                "module": mod,
                "files": list(MODULE_MAP.get(mod, ("?", "?"))),
                "summary": old["summary"],
            }
        else:
            new = new_eps[key]
            old_params = normalize_parameters(old.get("parameters", []))
            new_params = normalize_parameters(new.get("parameters", []))
            old_has_body = old.get("requestBody", False)
            new_has_body = new.get("requestBody", False)

            if old_params != new_params or old_has_body != new_has_body:
                changed[key] = {
                    "module": mod,
                    "files": list(MODULE_MAP.get(mod, ("?", "?"))),
                    "summary": old["summary"],
                    "diff": {
                        "parameters_before": old_params,
                        "parameters_after": new_params,
                        "requestBody_before": old_has_body,
                        "requestBody_after": new_has_body,
                    },
                }
            else:
                unchanged[key] = {"module": mod}

    # Check for new endpoints in implemented modules
    for key, new_ep in new_eps.items():
        if key in old_eps:
            continue
        mod = classify_endpoint(new_ep["path"])
        if mod is not None and key not in watched_keys:
            added[key] = {
                "module": mod,
                "files": list(MODULE_MAP.get(mod, ("?", "?"))),
                "summary": new_ep["summary"],
                "parameters": normalize_parameters(new_ep.get("parameters", [])),
            }

    return {
        "summary": {
            "total_watched": len(watched_keys & set(old_eps.keys())),
            "added": len(added),
            "removed": len(removed),
            "changed": len(changed),
            "unchanged": len(unchanged),
        },
        "added": added,
        "removed": removed,
        "changed": changed,
        "unchanged": {k: v for k, v in sorted(unchanged.items())},
    }


def extract_version(spec: dict) -> str:
    """Extract version string from OpenAPI spec."""
    return spec.get("info", {}).get("version", "unknown")


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)

    old_path = sys.argv[1]
    new_path = sys.argv[2]
    impl_path = sys.argv[3] if len(sys.argv) > 3 else "endpoints_impl.json"

    with open(old_path) as f:
        old_spec = json.load(f)
    with open(new_path) as f:
        new_spec = json.load(f)
    with open(impl_path) as f:
        impl_endpoints = set(json.load(f))

    old_eps = extract_endpoints(old_spec)
    new_eps = extract_endpoints(new_spec)

    old_ver = extract_version(old_spec)
    new_ver = extract_version(new_spec)

    report = compare_endpoints(old_eps, new_eps, impl_endpoints)
    report["versions"] = {"old": old_ver, "new": new_ver}

    print(json.dumps(report, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
