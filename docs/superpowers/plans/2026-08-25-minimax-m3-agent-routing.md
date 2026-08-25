# MiniMax M3 Agent Routing Implementation Plan

> **For AI agent workers:** Required sub-skill: use superpowers:executing-plans to implement this plan. Track progress with the checklist below.

**Goal:** Route official MiniMax M3 Agent sessions over the providers' native Anthropic Messages endpoints while preserving OpenAI Chat Completions as ordinary chat's default.

**Architecture:** The provider registry remains the sole owner of hosted model endpoint capabilities. A shared MiniMax provider-model override will advertise both supported protocols in preference order, and both regional presets will consume it; no Agent runtime, gateway, stream, schema, or persistence contract changes are needed.

**Tech Stack:** TypeScript, provider-registry catalog generator, Vitest, pnpm

---

## File Structure

- Modify `packages/provider-registry/src/__tests__/provider-endpoint-matrix.test.ts`: assert the public endpoint contract for both official MiniMax regions.
- Modify `packages/provider-registry/src/providers/minimax.ts`: define the shared MiniMax overrides and use them for the China preset.
- Modify `packages/provider-registry/src/providers/minimax-global.ts`: consume the same overrides for the international preset.
- Regenerate `packages/provider-registry/data/provider-models.json`: publish the source-defined provider-model endpoint rows. Other generated catalog files may change only if the required live generator reports upstream drift.

### Task 1: Declare and publish the MiniMax M3 endpoint capability

**Files:**

- Modify: `packages/provider-registry/src/__tests__/provider-endpoint-matrix.test.ts`
- Modify: `packages/provider-registry/src/providers/minimax.ts`
- Modify: `packages/provider-registry/src/providers/minimax-global.ts`
- Regenerate: `packages/provider-registry/data/provider-models.json`
- Possibly regenerate: `packages/provider-registry/data/models.json`
- Possibly regenerate: `packages/provider-registry/data/providers.json`

- [ ] **Step 1: Write the failing endpoint-matrix test**

Add this provider contract before the OpenCode matrix:

```typescript
describe('MiniMax endpoint matrix', () => {
  it.each(['minimax', 'minimax-global'])(
    '%s keeps Chat Completions first while exposing Anthropic Messages for Agent sessions',
    (providerId) => {
      expect(endpointsOf(providerId, 'minimax-m3')).toEqual([
        'openai-chat-completions',
        'anthropic-messages'
      ])
    }
  )
})
```

- [ ] **Step 2: Run the test and verify the red state**

Run:

```bash
pnpm exec vitest run --project provider-registry packages/provider-registry/src/__tests__/provider-endpoint-matrix.test.ts
```

Expected: FAIL with `Missing override: minimax/minimax-m3`; the failure must come from the missing provider-model fact, not from syntax or setup.

- [ ] **Step 3: Add the minimum shared provider override**

In `packages/provider-registry/src/providers/minimax.ts`, rename the exported shared array to `minimaxOverrides`, prepend the M3 routing fact, and use the renamed array in the China preset:

```typescript
export const minimaxOverrides = [
  {
    modelId: 'minimax-m3',
    endpointTypes: ['openai-chat-completions', 'anthropic-messages']
  },
  // Existing image overrides remain unchanged.
] satisfies NonNullable<Provider['overrides']>
```

In `packages/provider-registry/src/providers/minimax-global.ts`, import and use the same array:

```typescript
import { minimaxOverrides } from './minimax'

// ...
overrides: minimaxOverrides
```

Do not add a runtime MiniMax special case or a new reasoning contract: the model already declares reasoning support, the Anthropic endpoint uses the native dialect, and the existing Agent route selects Anthropic whenever the catalog advertises it.

- [ ] **Step 4: Run the endpoint test and verify the green state**

Run:

```bash
pnpm exec vitest run --project provider-registry packages/provider-registry/src/__tests__/provider-endpoint-matrix.test.ts
```

Expected: PASS, including both MiniMax regions and the existing endpoint matrices.

- [ ] **Step 5: Regenerate the catalog from source**

Run:

```bash
pnpm --filter @cherrystudio/provider-registry generate
```

Expected: generated provider-model rows for `minimax/minimax-m3` and `minimax-global/minimax-m3` contain the ordered endpoint list. Inspect all generated diffs and keep only generator-produced output; never hand-edit `data/*.json`.

- [ ] **Step 6: Run focused and package-level verification**

Run:

```bash
pnpm --filter @cherrystudio/provider-registry test
pnpm exec vitest run --project main src/main/ai/runtime/claudeCode/__tests__/agentSessionWarmup.test.ts
pnpm lint
```

Expected: all commands exit 0. The Agent test proving a model with Chat first and Anthropic available routes directly must remain green; `pnpm lint` may format files, so inspect the final diff afterward.

- [ ] **Step 7: Commit the implementation**

```bash
git add packages/provider-registry/src/__tests__/provider-endpoint-matrix.test.ts \
  packages/provider-registry/src/providers/minimax.ts \
  packages/provider-registry/src/providers/minimax-global.ts \
  packages/provider-registry/data/models.json \
  packages/provider-registry/data/provider-models.json \
  packages/provider-registry/data/providers.json
git commit -S --signoff -m "fix(provider-registry): route MiniMax M3 agents natively"
```

Verify the commit contains both an SSH/GPG signature and `Signed-off-by`, then confirm the worktree is clean.
