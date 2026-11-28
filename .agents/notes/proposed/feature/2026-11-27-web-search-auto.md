# Agent Note: Automatic web search in Assistant chat

Status: proposed

English | [中文](2026-11-27-web-search-auto.zh.md)

## Problem

[Issue #14897](https://github.com/CherryHQ/cherry-studio/issues/14897) asks to let the model decide when to search. The composer currently toggles search, and a global preference influences routing. Search and page fetching are routed independently, so native search can coexist with a client fetch tool. Some native adapters also explicitly force a search.

## Proposal

Add an opt-in Auto mode to the Assistant chat composer. Existing settings continue to select their current routing behavior until the user opts in. Turning search off suppresses the web tools supplied by this control.

In Auto, prefer eligible native search on endpoints with verified optional-search behavior. A request routed to native search must omit client search and fetch tools supplied by this control. If optional native search is unavailable, including after final compatibility checks, expose the existing configured client search as an optional model tool when supported. Auto does not independently expose client page fetching. Explicit URL tools outside this control retain their behavior. Show the existing configuration or unavailable state when neither path is eligible. Keep existing endpoint compatibility checks and unrelated tools intact. If explicit request overrides would force a search, show that Auto is unavailable for that request and do not silently dispatch a forced search in Auto.

Explicit forced sources, changes to defaults for newly created Assistants, provider coverage expansion, and plugin cleanup remain follow-up scope.

## Alternatives considered

Changing the global routing preference would affect existing Assistants and would still let search and fetch choose different routes. Removing client fetch globally would also change explicit URL handling for users who keep their current configuration.

## Acceptance criteria

- AC1 — Users can select Auto or turn search off from the Assistant composer. Existing saved settings retain their prior behavior until users select Auto, and the selection survives reopening the conversation. (verification: renderer)
- AC2 — The final serialized request for eligible native Auto exposes optional native search without forced-search parameters or client search and fetch from the composer. A request with search off exposes none of those web tools. An explicit override that would force a search is reported as an Auto conflict. (verification: unit)
- AC3 — An Auto request without eligible optional native search can expose the configured client search as an optional tool when supported, including when native eligibility is lost in final compatibility checks. When neither route is available, the composer shows the existing configuration or unavailable state. (verification: renderer and unit)
- AC4 — On a verified native endpoint, a plain question completes without a client search or fetch and a question that asks for current information can return a native search result. (verification: Electron with live provider)

## Risks

Optional search is endpoint-specific. Confirm behavior from provider documentation and an actual request before declaring an endpoint eligible. The renderer predicts routing while the runtime has the final request context, including tool compatibility and reasoning settings.
