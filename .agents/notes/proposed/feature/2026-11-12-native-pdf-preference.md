# Agent Note: Native PDF routing preference

Status: proposed

English | [中文](2026-11-12-native-pdf-preference.zh.md)

## Problem

Issue #22833 asks for control over native PDF input versus local extraction. The existing PR has no implementation. Current main resolves native file support in `src/main/ai/runtime/aiSdk/params/nativeFileSupport.ts`; capability and converter checks must remain authoritative. This proposal does not claim any provider currently accepts an unverified wire payload.

## Proposal

- Add a provider default with three choices: Automatic (existing routing), Prefer native PDF, and Extract text. A per-model override adds Inherit provider default. Missing persisted fields mean Automatic/inherit, preserving existing behavior.
- Effective precedence is model override, provider default, then Automatic. Store provider/model configuration through their existing owners, not a second preference store keyed by display names.
- Prefer native uses original PDF bytes only when the resolved provider/model/converter supports native PDF. Unsupported combinations use the existing local extraction path. Extract text disables native PDF for this request. Neither option overrides file access, size limits or capability denial.
- Resolve the effective setting for each actual target, including fallback models, not just the initial selected model. Do not mutate the attachment, discard the original file, or apply this preference to images/audio/video.
- Show the effective choice and unsupported-native fallback explanation in the model editor/provider settings using supported locales. Network/auth/model failures retain normal error handling: this feature adds no automatic second billable request after a failed native request.

## Alternatives considered

- Keep Automatic only: no migration or UI, but users cannot opt into text extraction for a capable model.
- Force native for every compatible-looking endpoint: rejected because a preference is not proof of wire support.
- A global toggle: simpler, but cannot express different provider/model requirements.

## Acceptance criteria

- AC1 — Missing settings preserve current routing; model override beats provider default and reset restores inheritance (verification: unit)
- AC2 — Supported Prefer native sends original PDF bytes; Extract text uses local extraction; unsupported Prefer native safely uses extraction without bypassing capability/file checks (verification: unit)
- AC3 — A fallback target resolves its own effective preference and support; no extra network attempt is introduced on native API failure (verification: integration)
- AC4 — Provider/model controls persist through restart, expose effective inheritance/fallback, and work with keyboard and screen readers in supported locales (verification: renderer and Electron)
- AC5 — A PDF containing layout, tables and a scanned page is exercised on one verified native target and one text-only target; record target, endpoint and observed payload without claiming universal support (verification: Electron)

## Risks

- Capability metadata can be stale. Prefer native is bounded by current converter support, not an unrestricted compatibility override.
- Extraction can lose layout. The UI must distinguish chosen text extraction from unsupported-native fallback.
- This is a proposed Spec, not approved behavior or completed implementation. Implementation waits for explicit human approval of the current Spec head.
