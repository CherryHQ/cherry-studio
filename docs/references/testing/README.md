---
description: Frontend, SQLite, DSH runtime and Agent fork testing references
sources:
  - tests
  - src/renderer
  - packages/ui
  - packages/dsh-bridge
  - src/main/ai/runtime/dsh
---

# Testing Reference

Testing policy and harnesses for Cherry Studio: what makes a test worth writing and how to exercise each layer of the app, from renderer UI down to the SQLite data layer.

| Document | Purpose |
| --- | --- |
| [Frontend Testing Guidelines](./frontend-testing.md) | Normative rules for renderer, packages/ui, and E2E tests — layer choice, mocking, and review gates |
| [Database Testing Guide](./database-testing.md) | The setupTestDatabase harness for SQLite-backed main-process code, with migration recipes and anti-patterns |
| [DSH Runtime Upgrade Tests](./dsh-runtime-upgrade.md) | Build, packaging, approval and sandbox checks |
| [Agent Session Fork Verification](./agent-session-fork.md) | Native boundaries, independent sessions, workspace copying and recovery |
