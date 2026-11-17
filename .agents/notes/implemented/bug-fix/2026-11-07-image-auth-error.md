# Agent Note: Redact image provider authentication errors

Status: implemented

English | [中文](2026-11-07-image-auth-error.zh.md)

## Problem

Regression MP-92 returned a synthetic HTTP 401 containing `Incorrect API key provided: <fixture key>`. The image error dialog displayed the credential instead of localized authentication guidance. The shared provider-error sanitizer recognized `api_key` fields but missed natural-language `API key` and `API key provided` labels.

## Decision

Extend the existing shared secret-text matcher with those labels so provider-error serialization removes their values before IPC and presentation. Map image errors with HTTP 401 or the existing `auth` category to `REQ_ERROR_TOKEN`, which already has localized guidance. Preserve other provider diagnostics and silent cancellation.

## Alternatives considered

- Hiding only the image popup would leave the echoed credential in serialized provider errors.
- Replacing every provider error with a generic failure would discard useful quota and outage diagnostics.

## Consequences

The shared sanitizer also protects other consumers of provider errors with these labels. This is a targeted redaction fix, not a guarantee that arbitrary unlabelled secrets can be identified. Image authentication failures use the existing translation; no new locale keys are needed.

## Verification

- Regression — two natural-language credential echoes and image HTTP 401 guidance failed before the fix and passed afterward.
- Regression — 155 tests passed across shared redaction, provider errors, main-process error serialization, image error handling and image generation.
- MP-92 retains HTTP request, credential non-disclosure, quota guidance, idle recovery and successful image persistence assertions for application-level acceptance.
