---
description: Frontend, SQLite, and remote Agent protocol testing references
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
| [Remote Agent Testing Specification](../ai/remote-agent-testing.md) | Target local WebSocket client acceptance through the real Desktop execution and persistence chain |

## Do not write behavior-pinning tests

Across all test projects, derive expectations from the promised contract, not from whatever the
implementation currently happens to do. Before keeping a test, answer both questions:

1. Which concrete production bug would make this test fail?
2. Would it still pass after an internal refactor that preserves the contract?

If the first answer is unclear or the second is no, remove the test or replace it with a test of the
actual contract. Do not preserve it just to keep the test count or coverage percentage high.

Observable product behavior is not automatically a contract worth freezing. The current default
provider, sidebar order, initial expansion state, page size, icon, or placement of a control may be
a changeable product choice. Copying that choice into a test only makes the next intentional change
require two edits. A test name or comment calling it a "contract" does not establish one.

Identify an independent reason for the expectation: a data-integrity invariant, a public consumer's
requirement, an external protocol, an accessibility requirement, or a concrete regression scenario.
For example, test that saved user choices survive a restart and that loading the next page loses no
items; do not freeze which choices ship by default or how many items the current page size contains.
When a case mixes useful behavior with product snapshots, remove the snapshot assertions and keep
the behavior. Do not replace deleted cases with equivalent snapshots at another layer.

Reject these patterns:

- **Testing the fixture:** create an object or mock function inside the test, then assert its own
  values or behavior without exercising production code. Reimplementing a parser or filter in a test
  does not test the real parser or filter.
- **Copying implementation output:** compute the expected value with the same implementation being
  tested, or approve a snapshot merely because it reflects the latest output.
- **Locking prose:** assert exact prompt instructions, translation catalog sentences, punctuation,
  or log wording. A prompt containing a safety sentence does not prove that a tool enforces it.
  Test prompt selection, interpolation, file loading, and actual permission decisions instead.
- **Locking internal structure:** assert a singleton's concrete class, private helper calls,
  internal hook registration counts, decorative classes, or incidental DOM nesting.
- **Duplicating configuration:** copy a preset catalog, default setting, menu order, pagination
  constant, migration ordering number, or schema version into an expected literal. Test the
  consumer's behavior or an independently defined compatibility invariant instead.
- **Claiming more than the assertion proves:** label a test "cleans up temporary directories" when
  it only checks that a local marker was assigned, or "escapes LIKE wildcards" when it only checks
  that a result exists. Use observable cleanup or matching results, or remove the false coverage.
- **Testing types at runtime:** assign a typed literal and assert the same literal. Use type-level
  assertions only for a meaningful public type contract; test runtime schemas with accepted and
  rejected inputs.

Judge the contract, not the matcher. An external request payload, a persisted row, an error code,
an accessibility role, a protocol identifier, and a relationship between independently maintained
registries can be legitimate exact expectations. A mock call can prove an external effect or its
absence; a small reviewed snapshot can describe a wire contract. Neither is grounds for automatic
deletion. Frontend-specific rules, including layout and snapshot exceptions, remain in the
[Frontend Testing Guidelines](./frontend-testing.md).
