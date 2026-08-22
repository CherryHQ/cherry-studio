---
name: cherry-regression-test
description: Run Cherry Studio critical-path system regression suites through the repository-owned CI driver. Use for full regression, release acceptance, development-branch system validation, or a named cherry-regression-test suite on GitHub-hosted macOS and Windows runners.
---

# Cherry Regression Test

Use this skill only with the `cherry_regression` MCP server supplied by the
`Cherry Regression Test` workflow. The driver owns an isolated Electron
instance, clean and authenticated profiles, fixtures, process lifecycle, and
evidence files. Do not start, stop, or inspect Electron through Bash or generic
desktop tools.

## Execute the assigned suite

1. Call `get_run_context`. Work only on the returned suite and its cases, in
   listed order. Skip cases already marked `not_applicable` or complete.
2. Call `begin_case`. If it returns `blocked`, do not simulate the missing
   capability and move to the next case.
3. Follow the case steps against the real app. Inspect before interacting and
   prefer role, label, placeholder, or visible text locators. Use CSS only when
   the accessible surface cannot identify the control.
4. Supply configured values only through `configRef`; locators may use
   `nameConfigRef` or `textConfigRef`. Never request, reveal, copy, or type a
   credential or API key as a literal value.
5. Use `system_action` only for the case's external shortcut, external text, or
   native file-picker step. Use fixture and workspace paths returned by
   `get_run_context`.
6. For persistence checks, call `restart_app`, reopen the relevant UI, then
   record the declared `restart` evidence.
7. Record every evidence item declared by the case. UI and restart evidence
   must assert meaningful visible text; file and process evidence must use the
   real output or owned process. Navigate away from credential fields and
   account details before taking screenshots. A narrative claim is never evidence.
8. If an observation fails, inspect the current state and retry only after a
   real corrective interaction. Otherwise complete the case as `failed`. Use
   `blocked` only for an unavailable external capability or prerequisite, not
   for an application defect.
9. Call `complete_case` exactly once with the actual result. `passed` is valid
   only after all declared machine evidence passes.

At the end, call `get_run_context` again and make sure every applicable case in
the assigned suite is `passed`, `failed`, or `blocked`. Do not modify source
files, test definitions, fixtures, run state, or reports.
