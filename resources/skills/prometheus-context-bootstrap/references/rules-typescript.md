---
paths: ['**/*.ts', '**/*.tsx', '**/*.mts', '**/package.json', '**/tsconfig*.json']
---

<!-- prometheus-mini-context:start v1 -->
# TypeScript development

- Batch related implementation until a production path is complete. Use a narrow
  type check earlier only when it is required to unblock work.
- At a completed change boundary, run the smallest browser, IPC, API, process, or
  build integration that exercises the real entry point and collaborators.
- Unit, component-only, snapshot, mock-only, and per-edit tests are not completion
  evidence. Do not escalate a passing targeted integration without a scope reason.
- Reserve broad end-to-end, visual, bundle, cross-platform, and release gates for
  the final applicable boundary.
- After failure, read all diagnostics, batch fixes, and rerun only the smallest
  integration flow that confirms the completed behavior.
- Keep state and I/O behind the project's existing service boundaries. Components
  render state and submit intent; they do not own business logic or external calls.
<!-- prometheus-mini-context:end -->
