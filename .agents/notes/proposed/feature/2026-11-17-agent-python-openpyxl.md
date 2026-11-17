# Agent Note: Provide openpyxl to the Agent Python runtime

Status: proposed

English | [中文](2026-11-17-agent-python-openpyxl.zh.md)

## Problem

Agents process XLSX files in `python_execute`, which runs Python 3.12 in Pyodide v0.28.0 inside the renderer (`src/renderer/workers/pyodide.worker.ts:17-18`, `src/main/ai/mcp/servers/python.ts:24-27`). Pyodide loads packages only from its own lockfile through `loadPackagesFromImports`, and fetches them from `cdn.jsdelivr.net` at run time. `pyodide-lock.json` for v0.28.0 includes `pandas` 2.3.0 but not `openpyxl` or its dependency `et-xmlfile`, so `import openpyxl` fails and the Agent must install nothing (no pip path exists) or convert the file by hand.

The uv-managed CPython in `src/main/services/binaryManager/pythonRuntime.ts` is a second interpreter. It serves mise pipx tools and currently installs only `bitstring<5` for babeldoc (`src/shared/data/presets/binaryTools.ts:59-70`). It is not the Agent's code runtime and is not changed by this proposal.

Two requirements in issue #19320 pull against each other. Agents must import `openpyxl` immediately, including offline, while the Pyodide package loader needs the CDN.

## Proposal

Ship `openpyxl` and its pure-Python dependency `et-xmlfile` with the Agent Pyodide runtime so that `import openpyxl` works without network access.

- Vendor the pinned wheels into the app's Pyodide assets and register them with Pyodide's package loader before user code runs. Both wheels are pure Python (`py3-none-any`), so no build step is needed.
- Pin the versions in one place that the Pyodide worker reads. Record the Pyodide version next to them, since a Pyodide upgrade may change the compatible set.
- Expose the installed `openpyxl` and Pyodide versions in the Agent runtime diagnostics.
- Keep the managed environment read-only: `micropip` and user installs stay out of scope. A missing package reports the managed dependency and does not run `pip install`.

Scope excludes the XLSX artifact preview, which is already served by `packages/file-preview`, and any other data-science package.

## Alternatives considered

- **Rely on Pyodide's CDN package set.** Rejected: openpyxl is absent from Pyodide 0.28.0, and this path needs the network, which the issue excludes.
- **Install openpyxl into the uv-managed CPython and bridge it to Agent code.** Rejected for this scope: the Agent code runs in Pyodide, so a bridge would add a second process, a new IPC contract, and a second Python version to keep compatible. It also cannot run offline without first provisioning that interpreter.
- **Upgrade to a Pyodide release that ships openpyxl.** Not chosen: upgrades change every Pyodide package at once and are a separate decision. It remains an option if a later Pyodide release includes openpyxl.

## Acceptance criteria

- AC1 — A clean managed Agent runtime with no network can run `import openpyxl`, open an existing workbook, change a cell, and save a valid XLSX (verification: Electron)
- AC2 — `openpyxl` and `et-xmlfile` load from the vendored wheels, and the Pyodide worker makes no network request for them (verification: renderer)
- AC3 — Runtime diagnostics show the openpyxl version and the Pyodide version (verification: renderer)
- AC4 — A missing or corrupt vendored wheel reports the managed dependency and runs no install command (verification: renderer)
- AC5 — Upgrading the app keeps the same vendored versions for existing Agent workspaces, and the pinned versions are checked in CI (verification: docs gate)

## Risks

- Vendoring adds about the size of openpyxl and et-xmlfile to the app bundle. The size must be measured before implementation.
- Pyodide's loader must accept an extra local wheel index without changing how other packages resolve. The implementation should verify this before committing to the design.
- If Pyodide later ships openpyxl, the vendored copy must be removed in favor of the CDN package to avoid two versions.
