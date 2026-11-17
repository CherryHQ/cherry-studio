# Agent Note: Parse documents with the MinerU 4.1 Tasks API

Status: implemented

English | [中文](2026-11-18-open-mineru-tasks.zh.md)

## Problem

MinerU 4.1 retains `/v1/health` but replaces the 4.0 Upload/Jobs protocol with Tasks. Accepting the new health fields alone leaves healthy deployments selectable but unable to parse documents. The [4.1 migration contract](https://github.com/opendatalab/MinerU/blob/mineru-4.1.3-released/docs/en/reference/migration_4_1.md) removes the old endpoints rather than providing a legacy fallback.

## Decision

Recognize Tasks only when health advertises local uploads and the default output bundle. Keep legacy `/file_parse` and 4.0 Upload/Jobs clients. The domain-owned Tasks client creates a single-file JSON manifest, persists the task identifier before uploading, polls the same task, and reads Markdown from its completed ZIP result using the existing streamed ZIP reader.

Recovery data distinguishes `tasks` from existing `v1` jobs and contains only the endpoint and task identifier. Credentials come from current settings; upload and result URLs are fetched again from task details. Creation is not automatically retried. Downloads and uploads retain URL validation, pinned DNS, and same-origin API-key handling. Existing job cancellation and restart policy remain unchanged; the adapter can rehydrate existing metadata but does not enable automatic cross-restart job recovery.

## Alternatives considered

- Making health validation permissive without implementing Tasks leaves the reported parsing failure unresolved.
- Replacing the 4.0 client breaks existing deployments and stored 4.0 job metadata.
- Returning a bare ZIP URL to generic persistence loses the provider's authentication requirements.

## Consequences

Compatible 4.1 deployments can parse local documents. Failed, canceled, incomplete, mismatched, and expired tasks never become successful document artifacts. ZIP processing uses temporary files rather than buffering the entire archive. PDF recognition quality and available models remain responsibilities of the configured MinerU service.

## Verification

- Regression — focused Open MinerU protocol, Tasks, legacy, V1, and handler tests verify protocol selection, upload ordering, resume behavior, invalid responses, credential boundaries, and ZIP extraction.
- Regression — local official `mineru==4.1.3` with the Electron file-processing IPC parses a DOCX containing Chinese text and a table, plus a text PDF, into persisted Markdown; an incorrect API key yields HTTP 401 and the configured key completes parsing.
