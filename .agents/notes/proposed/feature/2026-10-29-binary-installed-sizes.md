# Agent Note: Environment dependency installed sizes

Status: proposed

English | [中文](2026-10-29-binary-installed-sizes.zh.md)

## Problem

Environment Dependencies shows versions and availability without the size of the installed files. Reading install trees on the snapshot path would delay cards and other snapshot consumers.

## Proposal

The full settings view requests bytes through a separate batch IPC after accepting snapshots. Main measures ordinary file logical bytes in the uniquely active mise installation reported by the backend, after proving its canonical root belongs to Cherry's managed installs tree and contains the runnable canonical. Bundled tools measure only their own executable. System, absent, ambiguous, and core Rust installations remain blank. Rust's two isolated homes contain retained toolchains and caches rather than one current installation.

Use sequential, streaming, iterative traversal without following child links. Each item has a 100,000-node and 3,000 ms soft budget; a shared semaphore permits two scans. Incomplete measurements return null, never a partial sum. Main owns warnings; renderer failures stay silent. Internal Cache entries last 300,000 ms for success including zero, or 30,000 ms for null. Source, recipe, observed version and root identity guard reuse. Mutation revision, busy checks and stop invalidate old work; scans never hold the mutation mutex. The batch checks validity again before returning.

## Alternatives considered

- Reuse `getDirectorySize`: it reads whole directories, recurses without work/time bounds and logs errors at each failing layer; changing it would affect its markdown and mini-app consumers. Keep this bounded domain measurement separate.
- Stat shims or guess directories from recipes and versions: neither proves installation ownership, especially with aliases and npm/pipx recipes.
- Scan system directories or combine Rust homes: attribution exceeds one installation.
- Add sizes to snapshots or prefetch at boot: delays unrelated consumers and performs unrequested disk work.

## Acceptance criteria

- AC1 — Preset and displayed custom cards show reliable installed logical file bytes; unowned sources stay blank. (verification: unit + renderer + Electron)
- AC2 — Pending, null and rejected size requests add no size node, placeholder, error UI or renderer error log and preserve installation operations; real zero remains visible. (verification: unit + renderer + Electron)
- AC3 — Snapshots commit before sizes; mini and boot initiate no size work, scans use global concurrency two with sequential I/O and bounded work, and stale batches cannot publish. (verification: unit + renderer + Electron)

## Risks

The time budget cannot interrupt a pending OS call and excludes backend queries and semaphore waiting. External mutations without events are observed on a later request after TTL or identity changes. Logical bytes differ from allocated or reclaimable disk space. Real mise trees and Windows/Linux behavior require runtime verification.

## Verification

The implementation worker owns focused filesystem, manager, IPC and renderer tests and records actual gate results in the task report. The maintainer owns real Electron screenshots, real installation byte comparison and list timing before acceptance. This note remains proposed while those runtime checks are outstanding.
