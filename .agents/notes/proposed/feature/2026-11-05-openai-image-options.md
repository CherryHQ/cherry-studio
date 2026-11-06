# Agent Note: GPT Image 2.6 complexity and animated generation

Status: proposed

English | [中文](2026-11-05-openai-image-options.zh.md)

## Problem

The existing GPT Image 2.6 integration generates and edits static images but does not expose scene complexity or animated output. Upgrading the SDK alone does not connect those controls to Desktop requests.

## Proposal

The independently reviewed SDK maintenance in [PR #23678](https://github.com/CherryHQ/cherry-studio/pull/23678), tracked by [Issue #23677](https://github.com/CherryHQ/cherry-studio/issues/23677), is a prerequisite. This Spec governs the dependent Desktop integration in [PR #23684](https://github.com/CherryHQ/cherry-studio/pull/23684); AC1-AC2 record required dependency evidence. Use the AI SDK 6-compatible OpenAI adapter 3.0.137, preserve Cherry's existing compatibility patches, and retain ai 6.0.185.

Add complexity to generation and editing for Sunburst and Flare. Expose animated GIF output, frame count and frame duration for generation. The current adapter rejects GIF edits even though the OpenAI API documentation now lists that format; extending the upstream edit adapter is outside this feature. The public catalog records API capabilities, including GIF edits and encoded frame durations up to 655350 ms. Desktop projects these through each endpoint's selected adapter: OpenAI 3.0.137 limits duration to 2000 ms and hides GIF edits and their timing controls. Other adapters retain their own contract.

The central parameter catalog owns canonical value types. The OpenAI wire profile maps SDK camelCase options; the SDK serializes HTTP names. The form derives generation versus editing from the composer's current reference images, and submit uses the materialized image inputs. Explicit remix/upscale/merge modes retain their meaning. Frame timing is visible and forwarded only for GIF output. The painting UI uses automatic GIF frame dimensions and hides static-image sizing: a real four-frame request at 1024×1024 was rejected by the API sheet-size limit. Existing original-file persistence, image rendering and export own the returned animation bytes. GIF export always saves the original animation, including after display-only preview rotation or flipping. When references change a generation draft into a static-only edit, submit drops stale GIF format and timing.

Publish these new runtime semantics in registry stream v4, preserving the frozen v3 stream and baseline. The planned Desktop compatibility floor is 2.1.11, the next patch after the current 2.1.10 package version; release coordination must confirm that floor before publication.

## Alternatives considered

SDK 7 would expand the migration beyond the image requirement. Custom HTTP serialization or a downstream GIF-edit SDK patch would duplicate upstream ownership. Mirroring composer attachments into persisted draft mode would create a second source of truth.

## Acceptance criteria

- AC1 — Installed SDK generation and edit requests carry complexity; generation carries GIF format and timing, and invalid SDK options fail before HTTP (verification: unit)
- AC2 — Existing chat, Responses, tool-call and image URL compatibility patch contracts remain valid after migration (verification: unit)
- AC3 — Sunburst and Flare expose complexity and generation GIF controls; adding references removes generation-only animation controls (verification: renderer, Electron)
- AC4 — Canonical parameters reach the installed SDK under its expected namespace and HTTP field names; static output never carries stale GIF timing (verification: unit)
- AC5 — Real GIF generation returns an animation whose frame timing and original bytes survive persistence and export (verification: Electron)
- AC6 — Only the two target model records change semantically; catalog compatibility, translations and built-in knowledge manifests remain valid (verification: unit, docs gate)

## Risks

The OpenAI guide and API Reference specify 2–16 frames, while SDK 3.0.137 permits 2–64; the catalog follows the documented 16-frame ceiling. The SDK limits frame duration to 20–2000 ms, so Desktop exposes that subset without narrowing the public API catalog. Real validation records actual response metadata. GIF editing and other new SDK options such as SVG and markup are deferred. The catalog release floor must match the release that actually ships the runtime changes.

Sources: [OpenAI image guide](https://developers.openai.com/api/docs/guides/image-generation), [AI SDK 6 backport](https://github.com/vercel/ai/pull/24561), [Images API Reference](https://developers.openai.com/api/reference/resources/images/methods/generate).

The independent publisher repair in [PR #23687](https://github.com/CherryHQ/cherry-studio/pull/23687) is merged and preserves legacy model records by removing unknown image parameter keys. It preserves known parameter definitions, including their option values, so AC6 still requires verifying that older clients are not offered GIF options unsupported by their installed SDK. Frozen legacy validators remain unchanged. The existing implementation stays draft pending Approval of this Spec head and completion of release compatibility acceptance.
