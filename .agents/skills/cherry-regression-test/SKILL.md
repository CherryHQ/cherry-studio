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
5. Use `system-action` only for the case's external shortcut, external text, or
   native file-picker step. Use fixture and workspace paths returned by
   `get-run-context`.
6. For persistence checks, call `restart-app`, reopen the relevant UI, then
   record the declared `restart` evidence.
7. Record every evidence item declared by the case. UI and restart evidence
   must assert meaningful visible text; file and process evidence must use the
   real output or owned process. Navigate away from credential fields and
   account details before taking screenshots. A narrative claim is never evidence.
8. If an observation fails, inspect the current state and retry only after a
   real corrective interaction. Otherwise complete the case as `failed`. Use
   `blocked` only for an unavailable external capability or prerequisite, not
   for an application defect.
9. Call `complete-case` exactly once with the actual result. `passed` is valid
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
