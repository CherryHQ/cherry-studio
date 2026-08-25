---
title: BabelDOC's Python is provisioned by Cherry instead of mise
category: changed
severity: notice
introduced_in_pr: "#19098"
date: 2026-08-22
---

## What changed

Installing the BabelDOC PDF engine no longer asks mise for a Python runtime. Cherry provisions the interpreter itself with the bundled `uv` — from npmmirror's `python-build-standalone` mirror when the egress IP is in China, from the official source otherwise — and stores it under `Toolchain/mise/uv-python` in the app data directory. Settings → Dependencies therefore never grows a Python runtime card on a fresh install, and a first BabelDOC install from that page now asks for the exact pinned version instead of `latest`.

## Why this matters to the user

Mainland-China users can install BabelDOC at all: mise fetches its Python from GitHub releases, which is unreachable there, so the install used to die before any package was downloaded. Everyone else sees only that Python has stopped appearing as its own dependency entry — the interpreter still exists, is still managed by Cherry, and is still removed together with the app's data directory.

For users upgrading from an earlier v2 build, the Python that mise installed previously stays on disk; Cherry does not uninstall it. What Cherry does reclaim is the global *selection* it wrote for itself: after the next successful `pipx:` install, the `python` entry is dropped from mise's global config so mise stops resolving a runtime it no longer owns. A Python the user added themselves as a custom tool is left untouched, selection included.

## What the user should do

Nothing — automatic. Users upgrading from an earlier v2 build who want the disk space back can remove the old mise-managed Python from Settings → Dependencies, but only after removing the `pipx:` tools installed by the earlier build: those tools' virtual environments were built against that interpreter and stop working without it. Reinstalling them afterwards rebuilds them against Cherry's own Python.

## Notes for release manager

Pairs with #19102 (PyPI mirror fallback), which this PR is stacked on. The BabelDOC pin moves to `0.6.4.post4` in the same change, so an existing older install is reported as outdated once and updates on the user's next visit to the Translate page.
