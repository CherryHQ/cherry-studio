# Agent Note: Generated image animation contract

Status: implemented

English | [中文](2026-11-09-generate-image-animation-contract.zh.md)

## Problem

An Agent passed frame count and frame duration without selecting GIF. The OpenAI wire correctly omitted timing for non-GIF output, but the tool accepted the incomplete request. A one-frame PNG was produced and the Agent claimed the requested eight-frame animation had succeeded. The tool returned file names and IDs without evidence about the actual artifact.

## Decision

The shared painting tool execution rejects frame parameters unless `outputFormat` is explicitly `gif`, before invoking image generation. Its model-derived parameter descriptions explain that dependency. AI SDK and MCP use the same validation; the Paintings page's stale-parameter filtering remains unchanged.

After generation, the tool reads original FileEntry bytes and uses Sharp metadata to report the detected format, frame count and available frame delays. Optional metadata and warnings extend the existing file array, preserving historical `id`/`name` results. Both runtimes use the same textual projection. A GIF request whose format, frame count or supplied timing is not met retains its files and carries a warning against automatic paid retries. Missing or unreadable metadata stays unverified; cancellation still propagates.

## Alternatives considered

Inferring GIF from timing would conceal conflicting explicit formats. Tool descriptions alone cannot enforce the dependency. Rejecting timing in the shared wire would change the Paintings page's separate draft-cleanup behavior. Echoing requested metadata or trusting a file extension would reproduce the false success. Changing FileManager, AiService or the provider registry is unnecessary for this tool-owned contract.

## Consequences

Inspection adds one sequential read and a lazy Sharp metadata operation per generated file without re-encoding the artifact. Metadata establishes container facts, not visible motion, seamless looping or image quality. Read/inspection failure preserves the generated file and prevents verified-animation claims. No storage migration, provider request format, or automatic retry is added.

## Verification

- Regression — `PaintingTool.test.ts` rejects the observed missing-format input before generation, distinguishes PNG bytes from misleading GIF labels, reports real GIF frame delays, preserves unverified files and propagates cancellation during inspection.
- Regression — `cherryBuiltinTools.test.ts` checks the same input correction over an MCP connection and reports actual GIF timing while retaining original inline bytes.
- Regression — `MessageGenerateImage.test.tsx` and `markdownImageExport.test.ts` accept both historical results and results carrying inspection metadata and warnings.
- Regression — `openaiImageRequest.test.ts` and `openaiImageSdkOptions.test.ts` cover the installed adapter's GIF request fields and the unchanged non-GIF timing filter.
