# Knowledge FileManager / FileProcessing Handoff

Date: 2026-05-14
Repo: `/Users/eeee/Code/03_Forks/cherry/cherry-studio-v2-knowledge`

## Goal

Migrate knowledge file ingestion to the v2 FileManager model first, then wire PDF file processing in later phases. The first completed slice keeps runtime add APIs path-based while persisting knowledge file items as FileManager-backed entries.

## Current Decisions

- Knowledge file item data stores `source` and `fileEntryId`.
- Runtime add input for a single file remains `source` and `path`; Main owns `FileManager.ensureExternalEntry`.
- Directory roots keep `source` and `path`; directory expansion creates FileManager external entries for supported files.
- Knowledge supports text and document file categories. Image files are rejected for direct file adds and skipped for directory imports.
- UI may filter or mark unsupported files, but Main-side validation remains the trusted boundary.
- PDF file processing integration is deferred; current readers still index from the resolved FileManager physical path.

## Phase 1: FileManager-backed Knowledge Items

Status: implemented in this branch.

Scope:

- Replace persisted knowledge file item data from legacy inline `FileMetadata` to `fileEntryId`.
- Keep renderer/runtime file add input path-based.
- Normalize runtime file add inputs in `KnowledgeOrchestrationService` by creating or reusing an external FileManager entry.
- Resolve `fileEntryId` in `KnowledgeFileReader` before reading source files.
- Migrate legacy knowledge file items to FileManager entries when the original path still exists.
- Preserve v2 early missing-file behavior during migration when the legacy source path no longer exists.
- Update directory expansion to go through FileManager and skip unsupported file categories.
- Add shared knowledge file type helpers in `packages/shared/data/types/knowledge.ts`.
- Update UI to show unsupported selected files with a warning tooltip, while only submitting supported files.

Explicit non-goals:

- No PDF preprocessing through file processing.
- No processed markdown artifact ownership.
- No `processedFileEntryId`.
- No FileRef lifecycle changes.
- No FileManager IPC expansion for knowledge display.

## Phase 2: Optional PDF File Processing

Status: planned.

Goal: route PDF indexing through file processing only when a knowledge base explicitly configures a file processor.

Planned behavior:

- Detect PDF by resolved FileEntry extension.
- If no `base.fileProcessorId` is configured, keep current built-in PDF reader behavior.
- If `base.fileProcessorId` is configured, call file processing with `document_to_markdown`.
- Pass a FileManager-backed source identity to file processing.
- Use returned markdown text as the indexing document.
- If file processing fails, mark the knowledge item failed. Do not silently fall back to the built-in PDF reader.

Non-goals:

- No durable knowledge ownership of generated markdown artifacts.
- No reindex reuse policy.
- No artifact cleanup policy.

## Phase 3: Knowledge-owned Processed Artifacts

Status: planned.

Goal: make generated PDF markdown artifacts first-class knowledge-owned files with explicit lifecycle rules.

Planned decisions to finalize before implementation:

- Whether knowledge item data should store `processedFileEntryId`.
- FileRef role vocabulary, likely `source` and `processed`.
- Reindex behavior for replacing processed artifacts.
- Delete behavior for knowledge items, knowledge bases, and unreferenced internal artifacts.

Planned behavior:

- On successful PDF processing, persist the markdown artifact through FileManager.
- Link the processed artifact to the knowledge item.
- On reindex, replace the processed artifact and clean the old reference.
- Delete only internal generated artifacts that have no remaining refs.
- Never delete external source files.

## Relevant Files

- `packages/shared/data/types/knowledge.ts`
- `src/main/services/knowledge/KnowledgeOrchestrationService.ts`
- `src/main/services/knowledge/readers/KnowledgeFileReader.ts`
- `src/main/services/knowledge/utils/file.ts`
- `src/main/services/knowledge/utils/directory.ts`
- `src/main/data/migration/v2/migrators/KnowledgeMigrator.ts`
- `src/main/data/migration/v2/migrators/mappings/KnowledgeMappings.ts`
- `src/renderer/src/pages/knowledge/components/AddKnowledgeItemDialog.tsx`
- `src/renderer/src/pages/knowledge/components/addKnowledgeItemDialog/sources/FileSourceContent.tsx`
- `src/main/services/file/FileManager.ts`
- `src/main/services/file/toFileInfo.ts`
- `src/main/services/fileProcessing/FileProcessingOrchestrationService.ts`
- `src/main/services/fileProcessing/task/FileProcessingTaskService.ts`
