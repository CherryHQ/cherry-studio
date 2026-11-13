# Agent Note: Cached and concurrent release tool downloads

Status: proposed

English | [中文](2026-11-14-release-tool-downloads.zh.md)

## Problem

The [binary downloader](../../../../scripts/download-binaries.js) prepares mise, Bun, uv, ripgrep, and Windows MinGit. Development has a shared versioned cache, but `--packaging` writes into resources without using it. Tools download sequentially through synchronous curl subprocesses; pnpm store caching does not cover them.

First-attempt logs from [Release run 43434466816](https://github.com/CherryHQ/cherry-studio/actions/runs/43434466816) show fresh downloads for both Windows architectures and editions. Download-start through installation intervals total about 46 seconds per Windows job, including checksums, extraction, and publication. This single observation establishes repeated work, not a stable speedup or a network-only bottleneck.

This note owns tool archive reuse and download scheduling. The [release performance proposal](2026-11-13-release-build-performance.md) retains JS bundle, native ABI, release inventory, and signing/publication ownership.

## Proposal

### Verified archive cache

Add an optional packaging asset cache outside the checkout. CI supplies a dedicated `RUNNER_TOOL_CACHE` directory; direct packaging without it remains supported. Keep development's shared versioned cache behavior unchanged.

Cache official assets by their pinned SHA-256, including bare executables. Recheck digests on reuse; remove corrupt entries and fetch again. Different digests cannot alias, while identical assets can share a blob across targets. Keep partial transfers outside the saved cache. Isolate staging between tools and concurrent invocations while preserving owner-specific resume. Publish only complete verified blobs; verify an entry already published by a peer before reuse. Copy or extract into private target output without writable hard links or packaged/signed-file writeback.

Preserve curl retries, resume, Range-refusal fallback, target selection, version markers written after installation, and release rejection of incomplete tool inventories. Cache failure retains the ordinary verified download path.

### Bounded network concurrency

Use Node's asynchronous subprocess API for curl, allowing at most three active tool downloads per invocation. Keep extraction synchronous initially to avoid competing Windows PowerShell extraction processes. Wrapping synchronous calls in promises does not provide network overlap.

Wait for all started work before failure reporting and final cleanup. Development retains optional-tool warnings; packaging still runs `verifyBundledBinaries` and rejects missing tools. Windows architectures remain sequential; USB signing is unchanged.

### Release and Preview integration

Prepare tools in an explicit step before packaging, using checked-out application code. Reject a source lacking the new interface during compatibility preflight, before expensive work; never supply application build code from the control workflow. Keep the packaging hook's preparation/verification fallback for direct electron-builder use.

Formal self-hosted Windows keeps original assets in its persistent local tool cache across checkouts and edition jobs. Each runner owns a separate directory. Hosted Release/Preview targets restore Actions caches keyed by format, target platform/architecture, and source download manifest digest, excluding edition and source commit. GitHub branch visibility restrictions still apply.

Global alone saves each target's hosted cache; CN restores only. Simultaneous cold misses may independently download without adding an edition dependency. Save complete verified assets after preparation, before later packaging/signing can fail. Do not save partial transfers.

Computer Use's locked npm platform packages, verified Linux SQLite cache, JS bundle transport, COS, signing, and publication approval remain outside this change.

### Delivery and evidence

Deliver four stack layers: this Spec, archive caching, bounded concurrency, and workflow integration. Each implementation layer carries focused behavioral tests. The last layer updates the packaging README and bilingual release runbook.

Distinguish cache state, transfer, verification, and extraction where measurable. Remote cold/warm runs require authorization; missing target execution remains unverified. Local fixtures cannot establish Windows speedup, USB signing validity, or installer startup. Keep the note proposed until all acceptance criteria have actual evidence.

## Alternatives considered

- Cache final resources or signed output: reject because transport assets must remain independent of packaging mutation and signing.
- Reuse development's hard-linked output cache: defer because original assets have pinned digests and a smaller mutation boundary; development semantics need no change.
- Introduce COS, a custom HTTP downloader, or unrestricted concurrency: defer because curl already provides retries/resume and observed cost does not justify another transport or unbounded contention.
- Make every target wait for central prewarming: reject initially because distinct platform assets do not justify a new release dependency solely to avoid cold-cache duplicate downloads.

## Acceptance criteria

- AC1 — After one fetch, a fresh packaging directory prepares the tool offline; output mutation leaves its cache intact, and a changed digest cannot reuse the old blob. (verification: real local HTTP/cache fixtures; owner: archive cache layer)
- AC2 — Corruption, interrupted transfers, Range refusal, and competing publishers cannot create trusted partial assets, overwrite another invocation's partial file, or leave download debris in shippable resources. (verification: corruption, resume, failure, and concurrent-publication fixtures; owner: archive cache layer)
- AC3 — Cold tool requests overlap with at most three active downloads; all started work settles before exit, and successful tools retain correct target files and version markers. (verification: local HTTP concurrency/failure fixtures; owner: concurrency layer)
- AC4 — Direct packaging works without CI preparation, development retains its shared cache and optional-tool policy, and release verification rejects incomplete tools for all declared targets. (verification: explicit downloader and before-pack regressions; owner: cache and concurrency layers)
- AC5 — Both workflows use exact-source target tools, reject unsupported source interfaces before expensive work, retain sequential Windows architectures and signing, keep formal Windows cache local, and permit only one hosted writer per target without an edition dependency. (verification: workflow/interface checks and focused release tests; owner: integration layer)
- AC6 — Preparation saves only complete verified assets before packaging; target manifests remain valid, and cold/warm target logs confirm complete tools with unchanged installed versions. (verification: save-order fixtures and authorized target-run logs; owner: integration layer)
- AC7 — Documentation matches delivered behavior; reports identify cache states and measured/unknown phases without inferring stable speedup, USB signing, or install/startup validation from local checks. (verification: docs gate and actual evidence review; owner: integration layer)

## Risks

Restoring small assets may cost more than fetching them; report cache timings. Parallel transfers can contend for the runner's connection, and synchronous extraction can delay callbacks. Windows replacement and competing publishers need filesystem-specific proof. Asset versions consume disk; use existing runner maintenance and Actions eviction rather than adding a cleanup daemon. Frozen release sources need the interface before new workflows rely on it. Remote evidence may remain unavailable until separately authorized.
