---
description: Home for testing reference docs covering frontend test policy and the SQLite database test harness
sources:
  - tests
  - src/renderer
  - packages/ui
---

# Testing Reference

Testing policy and harnesses for Cherry Studio: what makes a test worth writing and how to exercise each layer of the app, from renderer UI down to the SQLite data layer.

| Document | Purpose |
| --- | --- |
| [Frontend Testing Guidelines](./frontend-testing.md) | Normative rules for renderer, packages/ui, and E2E tests — layer choice, mocking, and review gates |
| [Database Testing Guide](./database-testing.md) | The setupTestDatabase harness for SQLite-backed main-process code, with migration recipes and anti-patterns |
