# Agent Note: Unify file-preview icon mapping across attachment surfaces

Status: implemented

English | [中文](2026-11-05-file-preview-icon-mapping.zh.md)

## Problem

File-preview icon selection differed across composer tokens, message attachments, artifact cards, and the Files library. `odt/ods/odp/rtf/epub` had no token category, `markdown/jsonl/text/avif/heic/heif/tgz` had no icon-map entry, and artifact/format labels disagreed with the shared glyph map.

## Decision

Expand the presentation mapping only: token `word` gains `odt/rtf`, `excel` gains `ods/tsv`, `powerpoint` gains `odp`, `document` gains `epub`; icon map gains `markdown/jsonl/text/epub/avif/heic/heif/tgz`; artifact labels gain `mdx/epub`; format labels gain `odt/ods/csv/tsv/odp/rtf/epub/markdown/mdx/text`. Keep `documentExts`/`imageExts` unchanged so `officeparser`, image preview, and upload capability stay with their verified formats (legacy `.ppt` stays out of `documentExts`; `avif/heic/heif` stay out of `imageExts` and degrade to icon-only).

## Alternatives considered

- Expanding `documentExts` with `.epub/.ppt/.rtf` would route them through `officeparser`, which does not handle legacy binary PowerPoint or EPUB containers.
- Expanding `imageExts` with `avif/heic/heif` would enable thumbnail and AI-vision paths that are not verified for those codecs; icon-only fallback is safer.
- Adding an explicit `archive` token variant would change the `data-file-token-variant` contract pinned for archive/audio/video fallback; archives keep `fallback` with the `zip` glyph.

## Consequences

Composer tokens, message attachments, artifact cards, and Files labels share one office-family mapping. Unknown files keep generic `document` glyph with `fallback/FILE` variant, distinct from `text` variant. `documentExts`/`imageExts` remain the processing source of truth; presentation may be richer.

## Verification

- Regression — `src/renderer/utils/__tests__/fileIconName.test.ts`: office families, `epub/markdown/jsonl/text/avif/heic/heif/tgz` map to existing collection glyphs.
- Regression — `src/renderer/components/composer/tokenView/__tests__/fileTokenPresentation.test.tsx`: office/epub variants unified, archives/unknown stay on fallback.
- Regression — `src/renderer/components/composer/__tests__/ComposerToken.test.tsx`, `FileList.test.tsx`, `MainTextBlock.test.tsx`, `fileExtensions.test.ts`, `fileType.test.ts`: 69 passed in focused run.
- `pnpm exec tsc --noEmit -p tsconfig.web.json --composite false` clean.
