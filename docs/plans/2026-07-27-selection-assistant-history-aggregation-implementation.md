# Selection Assistant History Aggregation Implementation Plan

## Goal

Aggregate successful selection-assistant runs by configured assistant and action
while keeping every AI request context independent, and ensure each new selection
invocation replaces the previous result window.

## Task 1: Add aggregate temporary-chat promotion

Files:

- `src/shared/data/api/schemas/temporaryChats.ts`
- `src/main/data/api/handlers/temporaryChats.ts`
- `src/main/data/services/TemporaryChatService.ts`
- `src/main/data/services/__tests__/TemporaryChatService.test.ts`
- `src/main/data/api/handlers/__tests__/temporaryChats.test.ts`
- `src/main/data/api/handlers/__tests__/temporaryChats.integration.test.ts`

Steps:

1. Add an optional aggregate target (`key`, `name`) to the persist request.
2. Validate the request at the handler boundary.
3. Derive a stable topic ID from the temporary topic's assistant ID and target key.
4. In one write transaction, create the aggregate topic when absent or append to
   its current active message when present.
5. Preserve the existing same-ID promotion path when no aggregate target is supplied.
6. Restore temporary state after any failed transaction and notify topic readers
   only after commit.
7. Test stable reuse, separate keys/assistants, delete-and-recreate, message chains,
   assistant mismatch defense, rollback, and notification kinds.

Verification:

```bash
pnpm vitest run src/main/data/services/__tests__/TemporaryChatService.test.ts \
  src/main/data/api/handlers/__tests__/temporaryChats.test.ts \
  src/main/data/api/handlers/__tests__/temporaryChats.integration.test.ts
```

## Task 2: Route selection history into the aggregate topic

Files:

- `src/renderer/hooks/useTemporaryTopic.ts`
- `src/renderer/hooks/__tests__/useTemporaryTopic.test.ts`
- `src/renderer/windows/selection/action/components/ActionGeneral.tsx`
- `src/renderer/windows/selection/action/components/__tests__/ActionGeneral.test.tsx`

Steps:

1. Let `useTemporaryTopic.persist()` forward an optional aggregate target and use
   the returned persistent topic ID.
2. Keep placeholder-name patching only for normal same-ID promotion.
3. Pass a versioned action key and localized action name after successful selection
   generation.
4. Keep a fresh temporary topic per invocation and per regeneration.
5. Stop the active chat stream when the invocation subtree unmounts.
6. Test the aggregate payload, independent temporary topic reset, one persistence
   call per completion, and unmount cancellation.

Verification:

```bash
pnpm vitest run src/renderer/hooks/__tests__/useTemporaryTopic.test.ts \
  src/renderer/windows/selection/action/components/__tests__/ActionGeneral.test.tsx
```

## Task 3: Replace pooled result windows with one reusable singleton

Files:

- `src/main/core/window/windowRegistry.ts`
- `src/main/core/window/__tests__/windowRegistry.test.ts`
- `src/main/services/selection/SelectionService.ts`
- `src/main/services/selection/__tests__/SelectionService.test.ts`
- `src/renderer/windows/selection/action/ActionWindow.tsx`
- `src/renderer/windows/selection/action/__tests__/ActionWindow.test.tsx`

Steps:

1. Change `SelectionAction` from pooled to eager retained singleton lifecycle.
2. Remove selection pool resume/suspend operations.
3. Keep `processAction()` opening with a fresh `invocationId`; WindowManager then
   delivers the new payload to the same singleton.
4. Preserve per-invocation renderer keying and state reset.
5. Test the registry uniqueness contract and fresh payload delivery.

Verification:

```bash
pnpm vitest run src/main/core/window/__tests__/windowRegistry.test.ts \
  src/main/services/selection/__tests__/SelectionService.test.ts \
  src/renderer/windows/selection/action/__tests__/ActionWindow.test.tsx
```

## Task 4: Full verification and PR update

1. Run all focused tests.
2. Run the repository-required gates:

```bash
pnpm lint
pnpm test
pnpm format
pnpm build:check
pnpm test:lint
```

3. Inspect the final diff and verify every commit has both a `gpgsig` header and
   DCO sign-off.
4. Fetch before push, rebase if the remote branch advanced, push the exact branch,
   and confirm the existing draft PR reflects the new commits.
