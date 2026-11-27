# Agent Note: Inline model provider setup in chat

Status: proposed

English | [中文](2026-11-27-inline-provider-setup.zh.md)

## Problem

[Issue #15646](https://github.com/CherryHQ/cherry-studio/issues/15646) describes a break in the chat flow when a selected model needs provider credentials. [PR #21675](https://github.com/CherryHQ/cherry-studio/pull/21675) deferred inline setup and configuration badges to this issue.

## Proposal

Mark eligible API-key models whose provider has no enabled key. Open a compact setup surface from the model picker or when sending to such a model. The first slice covers already selectable API-key models whose provider needs only a key. Providers that need additional setup fields, disabled providers, models absent from the picker, revoked keys, and automatic resumption after visiting full settings are follow-up scope. Offer full provider settings for other setup paths. Preserve existing picker visibility rules and existing behavior for OAuth and keyless providers.

Reuse existing credential persistence and selected-model connection checks while preserving provider enablement. Require an explicit verified outcome before resuming a send. Automatic model discovery is follow-up scope because the existing sync hook skips providers with local models. A successful save and required validation may resume one intercepted send. Intercept ordinary direct sends before the composer clears the draft. Bind the pending send to the original conversation and branch, selected models, and draft revision including attachments. Queued follow-ups and edited-message resends retain their existing behavior. Cancel automatic dispatch if the user dismisses setup or changes any of those inputs. A setup opened from the picker alone has no pending send.

## Alternatives considered

Redirecting directly to settings uses the full provider form but interrupts composition. Saving and immediately replaying without a connection check shortens setup but exposes the draft to an avoidable authentication failure when the existing check is available.

## Acceptance criteria

- AC1 — An eligible model with no enabled API key shows a setup affordance in the picker. Configured, OAuth, and keyless models retain their existing selection and send behavior. (verification: renderer)
- AC2 — Sending with an eligible unconfigured model opens setup with the original draft intact. Completing setup and validation sends the original draft and attachments exactly once if the original conversation, branch, selected models, and draft revision are still active, including when Save is clicked twice. (verification: Electron)
- AC3 — Missing required fields or a failed connection check leaves setup available for correction and preserves the draft. Dismissal or a change of conversation, model, or draft prevents automatic dispatch. (verification: Electron)
- AC4 — The setup surface offers full provider settings. Opening or dismissing setup leaves provider enablement unchanged. (verification: Electron)

## Risks

Provider credentials and availability differ by authentication method. The supported provider matrix and authentication probes need verification during implementation. Provider validation and discovery may complete after navigation, so late results must respect the original send context.
