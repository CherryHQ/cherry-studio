---
description: Local model subsystem — the bundle catalog, on-disk registry, and the verified acquisition layer that installs models and shared native runtimes
sources:
  - src/main/ai/localModel
  - src/main/services/localModel
  - src/shared/data/presets/localModel.ts
---

# Local Models

Cherry Studio can run two models on the user's own machine: the knowledge-base
embedding model and the PaddleOCR text recognizer. Neither ships in the installer —
both are fetched on demand, together with the native onnxruntime binary they share.

This page covers **acquisition**: what can be installed, how bytes get onto disk
safely, and how they come off again. Inference over those models (the worker host,
the message protocol, hardware acceleration) still lives in `src/main/ai/inference`
and is documented alongside it.

## Layout

```text
src/main/ai/localModel/
├── index.ts                       ← the module's public API; import through it
├── registry/
│   ├── types.ts                   ← ModelBundle, SharedArtifact, InstallState
│   ├── catalog.ts                 ← the single source of truth: every bundle and artifact
│   └── LocalModelRegistry.ts      ← what is installed now; artifact install/remove
└── acquisition/
    ├── modelSource.ts             ← HuggingFace / ModelScope mirror table
    ├── downloadEngine.ts          ← mirror fallback, streaming + sha256, atomic writes
    └── tarballArtifact.ts         ← npm-published native runtimes
```

The per-model download services (`src/main/services/localModel`) drive the user-facing
lifecycle — status, progress broadcast, cancellation, removal — on top of this module.

## The catalog is the only per-model code

Everything about a model is one entry in `registry/catalog.ts`. Nothing else in the
subsystem branches per model, which is the property that keeps a third or fourth model
from adding a third or fourth copy of the download machinery.

### Bundles

A **bundle** is what a user installs: one capability's files, fetched, verified, reported
and removed as a unit. It is the first-class citizen rather than a single file because a
capability rarely is one file — OCR already needs detection weights, recognition weights
and a character dictionary, and a speech model would need its own acoustic model plus a
voice-activity detector.

Each `BundleFile` carries:

| Field | Purpose |
|---|---|
| `key` | Stable name for addressing one file (`detection`, `dictionary`, …) |
| `relPath` | Where it lands under the bundle's install dir; may nest |
| `repo` / `remoteFile` | What to fetch, resolved against a mirror at download time |
| `sha256` | Digest of the **fetched** bytes, verified while streaming |
| `minBytes` | Floor for the **installed** file, used by the disk scan |
| `weight` | Share of the bundle's progress bar (≈ file MB) |
| `derivation` | Optional transform applied before the bytes land |

`sha256` and `minBytes` describe different things whenever a `derivation` is present: the
OCR dictionary is fetched as the recognition model's `inference.yml` (digest checked) and
written as a parsed `ppocrv6_dict.txt` (size floor checked).

### Shared artifacts

A **shared artifact** is a native runtime published as an npm package — today only
`onnxruntime-node`. Bundles declare what they need in `requires`, and that declaration is
what makes the runtime removable: it outlives a bundle exactly as long as another
*installed* bundle still requires it.

`platforms` is a support matrix, not just a path table. A missing entry means the artifact
ships nothing there, so every bundle requiring it reads as `unsupported` rather than
offering a download that could only fail — which is how Intel Macs are handled, since
onnxruntime-node has no darwin-x64 build.

### Obtaining a checksum

Both mirrors publish digests, so adding a model needs no download:

- HuggingFace — `GET /api/models/<repo>/tree/main?recursive=true`, read `lfs.oid`
  (LFS files only; small files report a git blob SHA-1 instead)
- ModelScope — `GET /api/v1/models/<repo>/repo/files?Revision=master`, read `Sha256`

Compare the two before committing an entry. One digest can only serve a download that
falls back between mirrors if the file is byte-identical on both — true for every file in
the catalog today, and worth re-checking per file rather than assuming.

## Acquisition

One path, used by model files and runtime tarballs alike:

1. **Mirror fallback** (`withMirrorFallback`) — try each mirror in region order.
2. **Stream and verify** (`streamToFileVerified`) — hash while the bytes stream by.
3. **Atomic install** — write `${dest}.tmp`, rename only after the digest matches.

Two properties are worth stating because they are easy to break:

**Verification lives inside the attempt, not after the loop.** A mirror that serves a
stale, truncated or intercepted body fails exactly like an unreachable one, so the next
mirror still gets its turn. Verifying after the loop would let one bad-but-reachable
mirror make the whole download terminal.

**Abort is not a mirror failure.** A cancelled download stops at the current attempt
instead of walking the remaining mirrors re-issuing requests that would be aborted too.

The digest also replaced the size floor the download path used to depend on: a floor
cannot catch a corrupted body of the right length, while a digest catches truncation,
LFS pointers and captive-portal pages as a side effect.

## Install state comes from disk

`LocalModelRegistry` derives state by scanning, and stores nothing. A recorded flag drifts
the moment a user clears a directory behind the app's back, and recovering from "the
database says installed, the disk disagrees" is worse than the scan it would save.

Scanning checks existence and `minBytes` — never `sha256`. Hashing ~700MB of weights on
every status query would trade a correct answer for an unusable one; checksums are enforced
where the bytes arrive instead. The floor still catches the case that matters: a truncated
stub left by a killed download from before checksums existed, which would otherwise read
as a complete model and fail at load time.

Bundle files and shared artifacts are scanned separately, and callers compose them. A
bundle whose weights are complete but whose runtime is missing is an offer to download
~40MB, not a broken install — so it reports as not-installed rather than as an error.

## Removal

Removing a bundle has two independent questions, and they are answered in different places:

- **Is the bundle itself still in use?** A capability-specific concern — the embedding
  model checks whether any knowledge base still references it, and refuses if so. This
  guard belongs with the capability, not with the registry.
- **Is a shared artifact still needed?** A structural question answered from `requires`:
  the artifact goes when no other installed bundle declares it.

Both cases must release the inference worker before deleting files. The worker caches
native sessions with the weight files open, so on Windows an open handle makes the unlink
fail outright.

## Adding a model

1. Add a `ModelBundle` to `registry/catalog.ts` — every file with a real `sha256`
   (see [Obtaining a checksum](#obtaining-a-checksum)) and a `minBytes` floor.
2. Add its install directory to the path registry as a `feature.*` key
   (see [paths/README](../../../src/main/core/paths/README.md)).
3. If it needs a native runtime that is not already a `SharedArtifact`, add one and list
   every platform it ships binaries for — omissions are what make a platform unsupported.
4. Add the capability to the shared vocabulary in `src/shared/data/presets/localModel.ts`.

The catalog's own test suite enforces the mechanical parts (checksum present and
well-formed, keys and paths unique, `requires` resolvable), so a missed field fails in CI
rather than on a user's machine.

## Known limits

- The subsystem is mid-refactor: the download services and the inference host still live
  outside this module and join it in later steps.
- No remote catalog. Adding a model means shipping a release; nothing fetches the model
  list at runtime.
- No streaming download resume. A failed download restarts that file from zero.
