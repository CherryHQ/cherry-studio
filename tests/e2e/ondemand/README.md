# On-demand scenarios

See the [controller guide](../../../scripts/e2e/ondemand/README.md) for dispatch, JSON actions, language, timezone, evidence, and exit-code contracts.

`plans/smoke.json` is the default clean-profile smoke. `plans/example.json` demonstrates a temporary Chinese onboarding interaction. Neither requires a corresponding code spec. Keep scenarios separate from the fixed regression manifest and the smoke suite's per-test Electron launch fixture.

Reviewed code scenarios live under `specs/` and use the same controller-owned application. Follow the [frontend testing guidelines](../../../docs/references/testing/frontend-testing.md) and assert user-visible outcomes; never inject successful results.
