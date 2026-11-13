# Agent Note: 统一附件表面的文件预览图标映射

Status: implemented

[English](2026-11-05-file-preview-icon-mapping.md) | 中文

## Problem

文件预览图标在 composer token、消息附件、artifact 卡片和文件库之间不一致。`odt/ods/odp/rtf/epub` 没有 token 分类，`markdown/jsonl/text/avif/heic/heif/tgz` 缺少图标映射，artifact 与格式标签也与共享图标表不一致。

## Decision

仅扩展展示层映射：token `word` 增加 `odt/rtf`，`excel` 增加 `ods/tsv`，`powerpoint` 增加 `odp`，`document` 增加 `epub`；图标表增加 `markdown/jsonl/text/epub/avif/heic/heif/tgz`；artifact 标签增加 `mdx/epub`；格式标签增加 `odt/ods/csv/tsv/odp/rtf/epub/markdown/mdx/text`。保持 `documentExts`/`imageExts` 不变，使 `officeparser`、图片预览与上传能力仍限定在已验证格式（传统 `.ppt` 不进入 `documentExts`；`avif/heic/heif` 不进入 `imageExts`，仅显示图标）。

## Alternatives considered

- 将 `.epub/.ppt/.rtf` 加入 `documentExts` 会使其走 `officeparser`，而该解析器不支持传统二进制 PowerPoint 与 EPUB 容器。
- 将 `avif/heic/heif` 加入 `imageExts` 会启用未经验证的缩略图与 AI 视觉链路；仅显示图标更安全。
- 新增 `archive` token 变体会改变 archive/audio/video 共用 fallback 的 `data-file-token-variant` 约定；压缩包保持 `fallback` 与 `zip` 图标。

## Consequences

Composer token、消息附件、artifact 卡片与文件库共享同一 office 家族映射。未知文件保持通用 `document` 图标与 `fallback/FILE` 变体，与 `text` 变体区分。`documentExts`/`imageExts` 仍是处理层来源；展示层可以更丰富。

## Verification

- Regression — `src/renderer/utils/__tests__/fileIconName.test.ts`：office 家族及 `epub/markdown/jsonl/text/avif/heic/heif/tgz` 映射到已存在的图标。
- Regression — `src/renderer/components/composer/tokenView/__tests__/fileTokenPresentation.test.tsx`：office/epub 变体统一，压缩包/未知保持 fallback。
- Regression — `src/renderer/components/composer/__tests__/ComposerToken.test.tsx`、`FileList.test.tsx`、`MainTextBlock.test.tsx`、`fileExtensions.test.ts`、`fileType.test.ts`：聚焦运行 69 项通过。
- `pnpm exec tsc --noEmit -p tsconfig.web.json --composite false` 通过。
