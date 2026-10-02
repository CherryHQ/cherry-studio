---
description: Normative test rules for renderer, packages/ui, and E2E code covering layer choice, mocking, and review gates
sources:
  - src/renderer
  - packages/ui
  - tests/e2e
  - tests/__mocks__
---

# Frontend Testing Guidelines

This is the normative testing guide for `src/renderer/`, `packages/ui/`, and `tests/e2e/`.
It applies to tests written by humans and AI agents.

The goal is not to maximize the number of tests or lines covered. The goal is to keep the
smallest set of tests that gives strong confidence in user-visible behavior and stable public
contracts.

## Document Ownership

This file is the single source of truth for frontend test quality and review decisions.
Repository entry points should link here instead of copying these rules. More specific documents
may describe commands, fixtures, or infrastructure, but must not redefine when a test is valuable,
what it should assert, or how it should be reviewed.

If an older example conflicts with this guide, this guide wins. Existing tests demonstrate current
implementation history, not automatically approved patterns.

## 1. The Value Gate

Before writing a test, state the regression it is intended to catch.

A test is worth adding only when all of these are true:

1. It protects user-visible behavior, a documented public contract, or a previously observed regression.
2. A realistic production-code regression would make it fail.
3. The same behavior is not already protected at a more appropriate layer.
4. It can survive an internal refactor that preserves behavior.

If the regression cannot be stated concretely, do not add the test.

### Changes that normally require tests

- New or changed business rules, state transitions, validation, or reconciliation logic.
- User interactions that trigger persistence, IPC, navigation, clipboard access, or other side effects.
- Loading, empty, error, permission, and recovery states that materially affect the user.
- Accessibility contracts such as names, roles, disabled state, focus movement, and keyboard behavior.
- Cross-process, cache, serialization, lazy-loading, or mock-parity boundaries.
- Bug fixes: add the smallest regression case that would fail before the fix.

### Changes that normally do not require new tests

- Pure visual restyling with no documented layout or accessibility contract.
- A pass-through wrapper or re-export with no behavior of its own.
- Type-only changes already enforced by TypeScript, unless the type contract itself is the product API.
- Generated output that is already covered by its generator or contract check.
- Prop permutations that execute the same production branch.
- Defensive `does not throw` cases for impossible or unsupported inputs.

When a no-test change is non-obvious, explain why in the PR instead of adding a token test.

## 2. Choose the Lowest Sufficient Layer

| Behavior | Preferred test layer | What to assert |
|---|---|---|
| Pure transformation, parser, reducer, or state machine | Unit test | Inputs, outputs, transitions, and meaningful boundaries |
| Hook with state or external effects | Hook or small harness test | Returned contract and externally observable effects |
| Renderer component behavior | Component test | What a user can find, do, and observe |
| Generic `@cherrystudio/ui` primitive/composite | `packages/ui` test using the real component | Accessibility, interaction, and documented visual contract |
| Critical cross-window or cross-process workflow | E2E test | A complete user outcome |
| Compile-time public type contract | Type test | Accepted and rejected usage, with no duplicate runtime test |

Do not repeat the same behavior at every layer. A component test should not re-test every branch of
an already tested pure helper, and an E2E test should not enumerate every component prop.

## 3. Test Behavior, Not Implementation

Prefer assertions about:

- text, accessible names, roles, focus, and disabled state;
- visible state transitions after a user action;
- returned values and stable public data shapes;
- external effects such as an IPC request, navigation, persistence, or clipboard write;
- cleanup only when failing to clean up creates an observable leak or duplicate effect.

Avoid assertions about:

- internal hook call counts or registration order;
- private child-component props;
- incidental DOM nesting;
- CSS classes or inline styles that are not a documented contract;
- the presence of mocked placeholders;
- implementation-specific rerender counts.

Mock-call assertions are appropriate when the mock represents the external effect itself. They are
not a substitute for an observable outcome when the mocked function is an internal collaborator.

CSS/class assertions are allowed only when the class is itself the contract, for example an Electron
drag-region marker, a maintained UI semantic token, or a regression involving layout mechanics.
Add a short comment naming that contract.

## 4. Query and Interaction Priority

Use the same surface a user or assistive technology uses.

For Testing Library, prefer queries in this order:

1. `getByRole` / `findByRole` with an accessible name.
2. `getByLabelText`.
3. User-visible text or another semantic query.
4. A documented maintained selector.
5. `getByTestId` only when no meaningful semantic selector exists.

Use `queryBy*` for absence checks and `findBy*` for asynchronous appearance. Do not use
`document.querySelector`, DOM parent traversal, or CSS classes when a semantic query is available.

Use `userEvent.setup()` for normal user input such as clicking, typing, tabbing, and selecting.
Use `fireEvent` only for low-level browser events that `userEvent` does not model adequately, such
as a targeted scroll, resize, drag, or custom event.

For Playwright, use `getByRole`, `getByLabel`, and other user-facing locators before CSS selectors.
When a workflow needs an app-owned scope, start from a documented `data-ui` boundary and then use
an accessible locator within it. Because `data-ui` is a token set, match it with `~=`, never `=` or
substring matching.
See [E2E Testing Guide](../../../tests/e2e/README.md) for Electron-specific setup.

When asserting translated accessible names or text, fix the test locale. Mock translations only
when translation resolution itself is outside the subject's contract; do not replace meaningful
labels with translation keys merely to make a query convenient.

## 5. Mocking Rules

Mock the narrowest external boundary necessary to make a test deterministic.

Good mock boundaries include:

- IPC and preload bridges;
- persistence and network clients;
- clipboard, shell, and operating-system APIs;
- clocks, randomness, and heavyweight workers;
- an independently tested child surface when the parent test is specifically about composition.

Do not:

- mock the subject under test;
- mock pure functions or fast in-memory implementations without a concrete reason;
- mock every module imported by a component;
- recreate a complex production component inside a test mock;
- assert behavior that exists only in the mock.

### `@cherrystudio/ui` transition rule

Renderer tests currently have lightweight global stand-ins for `@cherrystudio/ui`. They may isolate
an unrelated UI leaf, but they do not prove the behavior of the real UI component.

- Do not add new behavior to the global `@cherrystudio/ui` mock for one feature test.
- Do not assert tooltip, popover, dialog, menu, focus, keyboard, or accessibility behavior against a
  stand-in and describe it as product coverage.
- Test generic UI behavior in `packages/ui` with the real component.
- If a renderer integration depends on real primitive behavior, opt into the real implementation for
  that focused test.

Any non-trivial shared fake must have a parity test against the real implementation or be reduced to
a call-recording boundary.

## 6. Cases to Reject During Review

Reject or rewrite tests whose only claim is:

- "renders without crashing";
- "renders children";
- "matches snapshot";
- "uses the default class name";
- "handles an omitted optional callback gracefully";
- "accepts empty text" when empty text has no distinct contract;
- "accepts special characters" when input is passed through unchanged;
- "calls an internal hook with these props";
- "the mocked child is present";
- "all props and boolean combinations render".

Also reject tests that would still pass if the relevant production behavior were deleted.

## 7. Snapshots

Snapshots are opt-in, not the default.

Use a snapshot only when:

- the complete serialized output is the reviewed public contract;
- the output is small and stable;
- a focused assertion would be less clear;
- the reviewer can understand the change without accepting a large opaque diff.

Do not snapshot component trees, generated class lists, large Markdown output, or mocked component
trees. Prefer explicit assertions for the behavior that matters.

Delete snapshots when their owning test is removed.

## 8. Regression Tests

A bug-fix test should document:

1. the user-visible failure or violated contract;
2. the smallest setup that reproduces it;
3. the assertion that would fail before the fix.

Issue or PR numbers are useful when they explain a non-obvious boundary. Avoid copying the entire
original incident into several layers of tests.

## 9. E2E Scope

E2E tests are for critical workflows whose risk crosses renderer, preload, main process, persistence,
or packaging boundaries. They are not the default place for component variants.

Use a Page Object only when multiple tests share a meaningful workflow or locator set. A one-off
interaction can stay in the spec; do not create an abstraction solely to satisfy a template.

Keep E2E tests independent, set the locale when asserting localized accessible names, and wait for a
user-observable condition rather than a fixed timeout.

## 10. Existing-Suite Policy

New and materially changed tests must follow this guide. Pre-existing tests do not justify copying
an obsolete pattern.

- Do not turn a focused feature change into an unrelated mass test cleanup.
- In a suite already being changed, remove or consolidate cases made redundant by that change.
- Do not preserve a low-value case solely because it increases test or coverage counts.
- If legacy infrastructure prevents a valuable test, document the limitation and propose the
  smallest upstream improvement instead of asserting against a fake or unstable selector.
- Keep infrastructure migrations and broad test deletion in dedicated changes so their review
  signal remains clear.

## 11. AI-Agent Workflow

Before editing tests, an AI agent must:

1. Read the production behavior and nearby tests.
2. List the specific regressions worth protecting.
3. List tempting cases that will intentionally not be tested.
4. Select the lowest sufficient layer and the narrowest mock boundary.
5. Add the minimum cases needed for those regressions.

Before finishing, the agent must answer:

- What production regression makes each new test fail?
- Would the test survive a behavior-preserving refactor?
- Is it asserting real production behavior rather than a fake?
- Is the behavior already covered elsewhere?
- Can any case be removed without losing a distinct failure signal?

If a newly created or materially expanded suite exceeds 300 lines, 15 cases, or five mocked internal
modules, treat that as a review signal. Explain why the scope belongs together or split/consolidate it.
These are review thresholds, not coverage targets.

## 12. Examples

### Good: user outcome

```tsx
it('copies the message and announces success', async () => {
  const user = userEvent.setup()
  render(<CopyButton textToCopy="hello" />)

  await user.click(screen.getByRole('button', { name: 'Copy' }))

  expect(navigator.clipboard.writeText).toHaveBeenCalledWith('hello')
  expect(toast.success).toHaveBeenCalled()
})
```

The clipboard and toast are external effects; their calls are the observable contract.

### Bad: implementation and passthrough

```tsx
it('renders the icon and wrapper', () => {
  const { container } = render(<CopyButton textToCopy="hello" />)

  expect(container.querySelector('div')).toBeInTheDocument()
  expect(container.querySelector('.copy-icon')).toBeInTheDocument()
})
```

This test depends on incidental DOM structure and does not protect the copy behavior.

## Related

- [Test Mocks](../../../tests/__mocks__/README.md)
- [E2E Testing Guide](../../../tests/e2e/README.md)
- [UI Semantic Contract](../components/ui-semantic-contract.md)
- [Testing Library query priority](https://testing-library.com/docs/queries/about/)
- [Vitest: Writing Tests with AI](https://vitest.dev/guide/learn/writing-tests-with-ai)
