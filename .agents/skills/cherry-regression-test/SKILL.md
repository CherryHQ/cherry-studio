---
name: cherry-regression-test
description: Run Cherry Studio critical-path system regression tasks through the repository-owned CI driver. Use for full regression, release acceptance, development-branch system validation, or a named cherry-regression-test task on GitHub-hosted macOS and Windows runners.
---

# Cherry Regression Test

Use this skill only with the `cherry-regression` MCP server supplied by the
`Cherry Regression Test` workflow. The driver owns an isolated Electron
instance, clean and authenticated profiles, fixtures, process lifecycle, and
evidence files. Do not start, stop, or inspect Electron through Bash or generic
desktop tools.

## Execute the assigned task

1. Call `get-run-context`. Work only on the returned task and its cases, in
   listed order. Skip cases already marked `not_applicable` or complete.
2. Call `begin-case`. If it returns `blocked`, do not simulate the missing
   capability and move to the next case.
3. Follow the case steps against the real app. Inspect before interacting and
   prefer role, label, placeholder, or visible text locators. Use CSS only when
   the accessible surface cannot identify the control. Locator fields combine:
   use `role` with `name` or `text` to identify one control. Never inspect
   `css: "*"`; inspect the body once if no specific control is visible yet.
4. Supply configured values only through `configRef`; locators may use
   `nameConfigRef` or `textConfigRef`. Never request, reveal, copy, or type a
   credential or API key as a literal value.
5. For the CherryIN login case, choose `Set up later` if onboarding is visible,
   open Settings > Model Provider > CherryIN, and call `authenticate-cherryin`
   exactly once after `Authorize with CherryIN` is visible. If the first body
   inspection after `begin-case` contains only an image, wait 10 seconds once,
   then inspect the body once; do not probe controls while the splash is shown.
   If authentication returns an error, do not retry it; finish the case as
   failed. Do not search Cherry Studio or an external browser for account and
   password fields. Record identity with `text: Logged in via OAuth` and
   `exact: true`.

   After login, follow the remaining M-01 steps literally. Open
   `Get model list`, fill its `Search models` textbox with
   `configRef: cherryInChatModel`,
   inspect `textConfigRef: cherryInChatModel` with `exact: true`, then click the
   first `role: button`, `name: Add`, `exact: true` result. Do not inspect a
   non-exact `Add`, clear the filter, scroll the list, select a fallback, or use
   `Add all models`. Call `action: press`, `key: Escape` against the search
   textbox once. Open `Model Check` by exact button name, click
   `Check all models`, click `Start`,
   wait 10 seconds, and record the persistent exact `Passed` text. The dialog has
   already closed when that status is visible; do not click `Close`.

   Click the exact `Back` button to return to Chat; do not search for a Chat
   button inside Settings. Click `role: button`, `name: Selected models`,
   `exact: true` (the visible button text is the current model), fill
   `testId: model-selector-search` with `configRef: cherryInChatModel`, and
   click the first `role: option` result. The selector closes after selection,
   so do not press Escape. Fill `css: [contenteditable='true']` with the literal
   prompt `Reply with exactly CHERRYIN_CHAT_PASS and nothing else.`, click the
   exact `Send` button, wait 10 seconds, and record the exact
   `CHERRYIN_CHAT_PASS` response. Capture `cherryin-chat` immediately, then
   restart. After a one-time splash wait if needed, open Settings > Model
   Provider and record `cherryin-restart` against the exact
   `Logged in via OAuth` text.
6. For M-02, open `Add Provider`. Fill exact `role: textbox` locators named
   `Provider Name*`, `API Key`, and `Anthropic` with the declared provider name,
   `configRef: customProviderApiKey`, and `configRef: customProviderBaseUrl`,
   respectively. Set `exact: true` on all three. Before submitting, record
   `custom-provider-redacted` against the exact API Key textbox while it still
   contains the configured value and remains a password input. Click the exact
   `Add` button. Do not put this
   Anthropic API URL in the OpenAI field. On the saved provider, click the exact
   `Add Model` button, fill the exact `Model ID` textbox with
   `configRef: customProviderChatModel`, then call `action: press`, `key: Enter`
   against that textbox. Do not use `Get model list`.

   Record `custom-provider-saved` against `role: main`, which contains both the
   provider name and exact model ID. Run `Model Check` with `Check all models`,
   wait 10 seconds, and record the persistent exact `Passed` status. Do not
   click `Close` afterward. Click the exact `Back` button, then select the model
   through exact button name `Selected models`; fill
   `testId: model-selector-search` with `configRef: customProviderChatModel`
   and click the first `role: option`. Fill `css: [contenteditable='true']` with
   `Reply with exactly CUSTOM_PROVIDER_CHAT_PASS and nothing else.`, click the
   exact `Send` button, wait 10 seconds, and record the exact response. Capture
   `custom-provider-chat` before restarting and verifying provider persistence.
7. Use `system-action` only for the case's external shortcut, external text, or
   native file-picker step. Use fixture and workspace paths returned by
   `get-run-context`.
8. For persistence checks, call `restart-app`, reopen the relevant UI, then
   record the declared `restart` evidence.
9. Record every evidence item declared by the case. UI and restart evidence
   must assert meaningful visible text; file and process evidence must use the
   real output or owned process. Navigate away from credential fields and
   account details before taking screenshots. A narrative claim is never evidence.
10. If an observation fails, inspect the current state and retry only after a
   real corrective interaction. Otherwise complete the case as `failed`. Use
   `blocked` only for an unavailable external capability or prerequisite, not
   for an application defect.
11. Call `complete-case` exactly once with the actual result. `passed` is valid
   only after all declared machine evidence passes.

## Keep execution bounded

- Do not repeat an equivalent failed inspection or interaction more than once.
  After one genuinely different corrective attempt, finish the case as
  `failed`, or `blocked` only when an external prerequisite is unavailable.
- Prefer one scoped inspection over several broad inspections. Do not explore
  unrelated navigation after the required control or feature is proven absent.
- Reserve the final two tool calls for `complete-case` and the final
  `get-run-context`. Once every applicable case is terminal, respond immediately
  without calling another tool.

At the end, call `get-run-context` again and make sure every applicable case in
the assigned task is `passed`, `failed`, or `blocked`. Do not modify source
files, test definitions, fixtures, run state, or reports.
