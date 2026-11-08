# Agent Note: Preserve legacy image models during catalog publication

Status: implemented

English | [中文](2026-11-06-legacy-image-catalog-publication.zh.md)

## Problem

A new canonical image parameter can make a frozen v2/v3 reader discard an entire model or provider override. Its validator returns successfully because the catalog uses per-entry forward compatibility. Publishing the original JSON after validation therefore hides model loss. See [Issue #23686](https://github.com/CherryHQ/cherry-studio/issues/23686).

## Decision

The publisher projects image parameter maps onto the vocabulary shared by frozen v1-v3 schemas before validation. This historical vocabulary belongs to the downgrade contract and must not grow with the current application enum. Projection covers every existing image mode on both models and provider overrides, preserving known parameter definitions apart from the legacy execution downgrades described below.

Legacy v1-v3 clients cannot execute the new GIF format control introduced by GPT Image 2.6. Published output-format enums omit `gif`, clear a removed GIF default, and omit a selector with no remaining choices. See [Issue #23763](https://github.com/CherryHQ/cherry-studio/issues/23763).

Parsing static choices is insufficient: the historical OpenAI image wire mapper also drops JPEG/WebP and compression settings. Explicit OpenAI image model endpoints retain only the four native bindings and four historical OpenAI vendor fields. Provider overrides resolve their own or inherited image endpoint against the provider adapter; OpenRouter and other executors retain their legitimate static choices. Unknown routes are not inferred to use OpenAI, and neither model IDs nor provider IDs select this rule. This publication-only contract does not restrict the current stream or change API capability facts. See [Issue #23770](https://github.com/CherryHQ/cherry-studio/issues/23770).

Changed files receive a new content-hash version using the catalog generator's shared serializer; the manifest records the emitted version. Unchanged files and the current schema stream retain their original bytes. Existing older-stream application floors and structural failure handling remain intact. Frozen validators are immutable.

## Alternatives considered

- Freeze older directories: rejects compatible future catalog updates promised to shipped clients.
- Drop entire models or special-case model IDs: removes usable behavior or couples compatibility to one vendor.
- Rewrite frozen validators or use the current enum: changes the historical reader contract instead of projecting to it.

## Consequences

The publisher owns one historical parameter vocabulary for v1-v3. New modes, protocols, and unsupported parameter-spec shapes do not gain inferred compatibility. The shared serializer is repository tooling with two production consumers; it changes no package export or bundled catalog.

## Verification

- Regression — `pnpm test:scripts scripts/__tests__/publishRegistryCatalog.test.ts scripts/__tests__/buildRegistrySyncRequest.test.ts`: actual publisher output is decoded by temporary copies of the frozen readers that expose their existing parse result; unknown keys no longer remove models or overrides across v1-v3 and all five image modes.
- Regression — The model-preservation assertion failed before projection; an independently calculated content-hash assertion failed before restamping. Current/unchanged bytes, manifest versions, application floors, and unrepresentable structural failures are checked through emitted files.

- Regression — Legacy format enums retain executable static choices and valid defaults across all v1-v3 modes and both record types. OpenAI image routes omit unmapped parameters; other adapters keep format and compression controls. GIF-only selectors disappear without dropping their model. Unchanged files and current-stream files remain byte-identical.
