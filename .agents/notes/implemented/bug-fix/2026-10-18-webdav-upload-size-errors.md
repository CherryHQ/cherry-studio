# Agent Note: Preserve WebDAV upload size failures

Status: implemented

English | [中文](2026-10-18-webdav-upload-size-errors.zh.md)

## Problem

A WebDAV HTTP 413 upload rejection reaches the backup UI as a generic failure. Automatic backup also spends its immediate retry budget on the rejected archive.

## Decision

Only upload errors with the WebDAV client's numeric `status` of 413 become `BACKUP_WEBDAV_TOO_LARGE: HTTP 413`. The existing shared backup mapper renders localized guidance to exclude attachments or choose storage with a higher upload limit. Automatic backup reports this failure immediately and keeps the next normal scheduled run.

## Alternatives considered

- Matching arbitrary server response text is brittle and can expose private server details.
- Hardcoding a Nutstore limit assumes an account-specific limit that HTTP 413 does not report.
- Chunking or splitting changes the backup format and restore contract; this repair does not introduce either.

## Consequences

Manual and automatic backup share the diagnostic. Other HTTP errors retain their existing handling. This does not let oversized archives upload successfully or reject them before transfer, and no Windows or real Nutstore account validation is claimed.

## Verification

- Regression — `src/main/services/__tests__/WebDav.test.ts`: a 413 upload yields the stable diagnostic for buffered and streamed data; 401 and 507 keep their original errors.
- Regression — `src/main/services/__tests__/AutoBackupService.test.ts`: a size rejection produces a failure without immediate retries, and the next normal schedule remains enabled.
- Regression — `src/renderer/utils/__tests__/backup.test.ts`: the IPC message maps to the localized size guidance.
