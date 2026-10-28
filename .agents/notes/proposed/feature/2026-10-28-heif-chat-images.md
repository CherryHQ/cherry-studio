# Agent Note: HEIF chat images

Status: proposed

English | [中文](2026-10-28-heif-chat-images.zh.md)

## Problem

iPhone HEIC/HEIF photos require manual conversion before chat preview and vision dispatch. Chromium cannot decode HEVC, and the shipped sharp build cannot decode it either. Adding extensions alone leaves admitted images unusable.

An active-note search for HEIF, HEIC, rendition and the rejected storage seams found no existing decision owner. This is a new feature Spec. The maintainer's single-issue/one-PR dispatch overrides the normal separate Spec PR and implementation stack layout, not its content requirements. Parts A/B implement this proposal in the same change set. No separate Spec-head approval, or approval of this exact revision, is claimed. Keep this note proposed pending maintainer review and outstanding evidence.

## Proposal

Preserve original identity, name and bytes. The lifecycle-owned `src/main/services/HeifRenditionService.ts` resolves entry/path handles or bytes via `file.get_heif_rendition`; `src/main/utils/image.ts` owns byte transformation. Use bounded versioned file reads, hashing actual bytes each time. No derived FileEntry, persistent PNG/cache, temporary file, schema or migration is needed. No remote URL fetching or caller-selected limits are added.

Decode the primary top-level image, or deterministically the first top-level image only if no primary is exposed. Produce full-resolution 8-bit RGBA PNG, applying orientation/mirroring once and preserving alpha. Lazy-load `libheif-js/libheif-wasm/libheif-bundle.mjs`, using a fresh WASM instance per uncached conversion. Use lower-level bindings; release image, handle and context in `finally`; pass decoded RGBA to sharp's raw-input PNG encoder, never HEVC bytes.

| Boundary                   | Limit                                                                                                |
| -------------------------- | ---------------------------------------------------------------------------------------------------- |
| Encoded input / PNG output | Each ≤ 67,108,864 bytes (64 MiB)                                                                     |
| Width and height           | Positive safe integers, each ≤ 16,384                                                                |
| Primary-image pixels       | ≤ 50,000,000; validate before decode/allocation and again on returned channels                       |
| Active conversions         | 1; hold slot until underlying conversion finishes                                                    |
| Waiting work               | ≤ 8 requests; retained waiting inputs ≤ 128 MiB                                                      |
| Deadline                   | 30,000 ms from admission, soft                                                                       |
| Encoded-result LRU         | `heif-png-v1:` + SHA-256 of actual bytes; ≤ 16 entries / 64 MiB; TTL 300,000 ms; no negative caching |

Equality is permitted. Coalesce concurrent equal hashes; remove rejected in-flight work. A canceled consumer must not cancel work another consumer needs. Renderer owners create/revoke independent PNG Blob URLs and discard stale results. Shutdown rejects pending work and clears retained state.

| Surface                         | Contract                                                                                                                                                                       |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Picker/drop/existing file paste | Admit `.heic`/`.heif` case-insensitively; preserve modality gates                                                                                                              |
| Composer tokens                 | Editable/restored/queued/read-only hover uses PNG; activation keeps pane preference and popup fallback                                                                         |
| Sent images                     | Single/grouped thumbnail and lightbox, including reload/edit/resend, use PNG                                                                                                   |
| File preview                    | Desktop-only HEIF pane/tab plugin; portable package deliberately unchanged                                                                                                     |
| Files                           | Grid icon; activation via ImagePreviewService; thumbnails deferred because raw HEIF cannot render and grid rendition ownership is undefined                                    |
| Vision wire                     | Canonical entries/file URLs/declared inline HEIF become transient `image/png` data and PNG basename; persisted originals unchanged; first-party Claude Code shares preparation |
| Non-vision                      | Localized HEIF rejection before OCR; offer JPEG/PNG conversion or a vision model; normalization across OCR backends deferred                                                   |
| External/path-only Claude Code  | Existing path fallback retained; normalization deferred because it bypasses first-party preparation                                                                            |
| Remote HEIF                     | Fetching/normalization outside this local contract                                                                                                                             |

Conversion failures stop dispatch, including bad HEIF in active history: remove/exclude it before a later turn proceeds. `HeifAttachmentError` carries fixed application messages and localization keys, never raw decoder diagnostics or paths. IPC distinguishes `FILE_HEIF_INVALID`, `FILE_HEIF_UNAVAILABLE`, `FILE_HEIF_TOO_LARGE`, `FILE_HEIF_TIMEOUT`, `FILE_HEIF_BUSY`, `FILE_HEIF_READ_FAILED`; size details may identify `input_bytes`, `dimensions`, `pixels`, `output_bytes`. Abort remains abort; other attachment failures retain existing behavior.

## Alternatives considered

- Persistent derived FileEntry: rejected; adds identity, persistence, reference and cleanup ownership while pre-send preview still needs decoding.
- Send-only conversion: rejected as the primary seam; wire materialization remains a consumer but cannot satisfy composer or historical display alone.
- Renderer-side decoding: rejected; duplicates ownership across windows and still requires main decoding for background/historical sends.
- Worker/utility-process isolation: deferred for round one; adds an execution lifecycle. Revisit on demonstrated stalls/crashes/memory growth or enforceable cancellation requirements; prefer a utility process for process-memory/crash isolation.

## Acceptance criteria

- AC1 — Tracked HEVC input is admitted with its original name and renders in composer, sent single/grouped images, lightbox and desktop pane/tab, survives reload/edit/resend, and owner cleanup leaves other previews usable. (verification: renderer + maintainer Electron)
- AC2 — Entry/file-URL/inline-data and first-party Claude Code produce PNG MIME/signature with no local paths/internal IDs on wire; stored original name and SHA-256 are unchanged. (verification: main + maintainer Electron)
- AC3 — Corrupt HEIF shows localized conversion guidance with zero chat requests; non-vision HEIF shows its OCR limitation with zero OCR/chat requests; ordinary PNG send/OCR remains intact. (verification: main + maintainer Electron)
- AC4 — Limits, queue bounds, unchanged-size/mtime content invalidation, failed retries, consumer cancellation and cleanup satisfy the contracts above. (verification: main + renderer)
- AC5 — Primary-versus-first, orientation, mirroring and alpha are verified with representative fixtures; packaged Windows x64 decodes the embedded module and ships decoder notices/source/rebuild information. (verification: maintainer packaging + fixtures)
- AC6 — Representative 12 MP/48 MP photo timing and repeated-conversion memory justify same-process execution; provisioning verifies frozen-lockfile installation. (verification: maintainer Windows x64 + CI)

## Risks

Accept pinned production `libheif-js@1.23.5` (LGPL-3.0), libheif 1.23.5 and libde265 1.0.15 (LGPL-3.0-or-later), WASM initialization cost, main-process synchronous decoding and the deferred surfaces above. `resources/licenses/heif/README.md` inventories source/build references, licence hashes and rebuild/replacement steps; `electron-builder.yml` ships notices to `licenses/heif`. Configuration does not prove packaged inclusion or loading.

The 30-second deadline is soft: synchronous WASM can block main and overrun it; cancellation is cooperative. Byte/pixel/queue limits are not an RSS ceiling. Repeatable main-loop stalls over 250 ms for ordinary 12 MP photos or one second for accepted 48 MP photos on Windows x64, reproducible hang/crash, continuing memory growth after completed conversions, or a hard-deadline/cancellation requirement trigger execution-ownership review before merge. These are thresholds, not obtained measurements.

## Verification

- AC1 — Parts A/B report focused main/shared/renderer Vitest evidence. `tests/e2e/smoke/heifChatImages.test.ts` is written, not run; maintainer Electron evidence is pending.
- AC2 — fileProcessor and ClaudeCodeRuntimeDriver regressions own normalization evidence; the smoke captures request JSON and hashes managed originals. Runtime evidence remains pending.
- AC3 — attachmentRouting regression asserts rejection before OCR. The mock chat helper exposes no OCR invocation counter; zero-OCR runtime observation remains a gap, not a fabricated backend bypass.
- AC4 — HeifRenditionService, image and renderer lifetime tests own focused evidence; passing suites alone do not establish every boundary.
- AC5 — Synthetic 96×64 quadrants are original repository artwork encoded with macOS sips; fixture README records hashes/provenance. They do not establish primary selection, orientation, mirroring or alpha. Representative fixtures and packaged loading remain pending.
- AC6 — Representative photo timing/memory, Windows x64 and frozen-install evidence remain pending. Enlarged solid-color probes are insufficient. Part-C static gate results are recorded in its handoff.
- Regression — Portable preview, grid thumbnails, ordinary-image OCR and external Claude Code are not broadened. Missing runtime/package evidence prevents declaring this Spec implemented.
