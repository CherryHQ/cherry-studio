# Reviewed code scenarios

Prefer a temporary JSON plan for supported UI actions. Add `<safe-name>.ts` only when the scenario requires reviewed code, and export a default async function accepting `ScenarioContext` from `scripts/e2e/ondemand/steps.ts`.

Use `context.page` for the owned main window, `context.runSteps(steps, options?)` for recorded actions/assertions, `context.screenshot(name?)` for masked evidence, and `context.ensureChinese()` for language preparation. At least one recorded required step must complete. A scenario cannot return its own passing verdict. The controller owns attachment, final environment checks, reporting, and cleanup; do not launch a second application or close its browser connection.

The dispatch `plan` is not an argument to a code scenario: when supplied, it defines the entire temporary test. Code scenarios undergo normal repository review; the QA read-only identity does not need write access to dispatch temporary plans.
