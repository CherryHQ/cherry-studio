# Agent runtime goal 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `packages/agent-runtime` 里实现 Pi 版 goal 扩展：持久目标、`agent_before_settle` 续跑、运行时拥有的全部停止策略、`get_goal / create_goal / update_goal` 工具和 `/goal` 命令。

**Architecture:** 两个源文件。`goalState.ts` 是纯函数：类型、状态迁移、校验、从 branch 读状态、进展判定、提示词。`goalExtension.ts` 用 L3 的扩展工厂模式（`createAskUserExtension` 同款）把它们挂到 Pi 的 `session_start / turn_start / tool_call / turn_end / agent_before_settle / agent_settled` 上，所有状态变更都以 `cherry.goal` 自定义条目写入 session，由 L2 的 transcript 往返。宿主只实现 `GoalPort`。

**Tech Stack:** TypeScript、`@earendil-works/pi-coding-agent` 1.1.0 扩展 API、`@earendil-works/pi-ai` 的 TypeBox `Type`、Vitest 5、包内已有的 `tests/support.ts`（`scriptedModel`、`streamTextPort`、`createTestSession`、`hostStore`）。

**Spec:** `docs/superpowers/specs/2026-10-11-agent-runtime-goal-design.md`

**执行时机：** 排在 L4 之后。任务 1–10 不依赖 L4；任务 8 的 `onApproval` / `hasRunningChildren` 只在包内按端口测试，宿主适配属于 L4 之后的接入 PR。

## Global Constraints

- 包不 import `src/`、`@main`、`@shared`、`@logger`、`@application`；不写日志（README "Boundaries"）。
- 每个"停"的决定都由运行时做出，不依赖模型配合（spec §1）。
- 状态变更只通过 `pi.appendEntry('cherry.goal', snapshot)` 持久化；`armed` 永不持久化（spec §5.1）。
- 轮数只在 `turn_start` 确认被接纳后递增（spec §6.3）。
- 续跑前必须先追加一条 `cherry.goal-round` 消息再返回 `continue: true`（spec §6.2）。
- 工具名、输出形状沿用 DSH：`{ goal: null }` 或 `{ goal, activation }`；空字符串和 0 视为未填（spec §8.1）。
- objective 1–4000 字符；`maxGoalRounds ≤ maxGoalRoundsCeiling`（spec §5.1、§7.1）。
- 默认值：`maxGoalRounds` 100、ceiling 1000、`blockedAfter` 3、无进展 2 轮提示 3 轮停、轮内重复 3 次提示 5 次停（spec §12）。
- 测试：每个测试写明破坏什么时失败；不写只记录现状的测试（CLAUDE.md "No behavior-pinning tests"）。
- 提交：`git commit -S --signoff`，Conventional Commits，scope `agent-runtime`。
- 门禁：`pnpm test:agent-runtime`、`pnpm --filter @cherrystudio/agent-runtime typecheck`、`pnpm exec oxlint --deny-warnings <files>`、`pnpm exec eslint <files>`、`pnpm exec oxfmt --write <files>`。

## Review Focus

spec 没有逐条写、但用户一定会碰到的输入。每条都在所属任务里加了测试：

1. 用户在 goal 轮流式输出时发了普通消息：goal 必须让路，处理完后继续，且不丢目标（任务 5）。
2. 模型在 `update_goal(complete)` 里给了陈旧 revision（它没先调 `get_goal`）：必须拒绝并附当前视图，不能把目标标完成（任务 4）。
3. 模型每轮只调一次只读工具就停（弱模型常见）：三轮后必须以 `no_progress` 停下，而不是跑满 100 轮（任务 7）。
4. 应用在 goal 轮中间崩溃，下次打开：目标显示为非武装，不自动续跑，`/goal resume` 能继续（任务 10）。
5. 后加载的扩展把 `continue` 覆盖为 `false`：轮数不能递增，UI 必须看到 `continuation_rejected`（任务 5）。

## 文件结构

| 文件 | 职责 |
|---|---|
| `packages/agent-runtime/src/goalState.ts` | 纯函数：类型、常量、状态迁移、校验、`currentGoal` / `isHumanTurn` / `tailRound` 读 branch、`turnProgress`、`toolCallKey`、`renderRoundPrompt`、`goalView` |
| `packages/agent-runtime/src/goalExtension.ts` | `GoalPort`、`GoalVerifier`、`createGoalExtension`：工具、命令、事件处理、内存运行态 |
| `packages/agent-runtime/src/askUserExtension.ts` | 加 `outcome` 字段（任务 1） |
| `packages/agent-runtime/src/index.ts` | 导出 |
| `packages/agent-runtime/README.md` | Extensions 一节加 goal |
| `packages/agent-runtime/tests/goalState.test.ts` | 纯函数测试 |
| `packages/agent-runtime/tests/goalSupport.ts` | 测试助手：`goalPort()`、`goalModel()`、`snapshots()` |
| `packages/agent-runtime/tests/goal.test.ts` | 工具、命令、续跑、接纳 |
| `packages/agent-runtime/tests/goalStops.test.ts` | 上限、预算、无进展、需要人、错误、中止、自报 |
| `packages/agent-runtime/tests/goalRebuild.test.ts` | 门控、重建、压缩 |

---

### Task 1: L3 前置：`AskUserQuestionDetails.outcome`

**Files:**
- Modify: `packages/agent-runtime/src/askUserExtension.ts:43-48, 104-135`
- Modify: `packages/agent-runtime/tests/askUser.test.ts`

**Interfaces:**
- Produces: `AskUserQuestionDetails.outcome: 'answered' | 'declined' | 'unavailable' | 'aborted'`，任务 8 用它区分"用户关掉了提问"和"无人可答"。

- [ ] **Step 1: 写失败的测试**

在 `tests/askUser.test.ts` 的 `it.each`（"reports $name as an error result and lets the run continue"）里给每行加 `outcome` 并断言：

```ts
  it.each<{ name: string; response: AskUserResponse; text: RegExp; outcome: string }>([
    {
      name: 'declined with feedback',
      response: { status: 'declined', feedback: ' Use Postgres, stop asking. ' },
      text: /dismissed the questions.*said:\nUse Postgres, stop asking\.$/s,
      outcome: 'declined'
    },
    {
      name: 'declined without feedback',
      response: { status: 'declined' },
      text: /dismissed the questions.*Wait for the user's instructions/,
      outcome: 'declined'
    },
    {
      name: 'unavailable',
      response: { status: 'unavailable' },
      text: /proceed without asking the user and state your assumptions/,
      outcome: 'unavailable'
    }
  ])('reports $name as an error result and lets the run continue', async ({ response, text, outcome }) => {
    // ...现有断言之后：
    expect(result.details).toMatchObject({ outcome })
  })
```

在"answered"测试的 `expect(result.details).toEqual({...})` 里加 `outcome: 'answered'`；在 abort 测试里断言 `outcome: 'aborted'`。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run --project agent-runtime packages/agent-runtime/tests/askUser.test.ts`
Expected: FAIL，`details` 缺少 `outcome`。

- [ ] **Step 3: 实现**

```ts
export interface AskUserQuestionDetails {
  questions: AskUserQuestionItem[]
  answers: Record<string, string>
  annotations?: AskUserAnnotations
  /** How the call ended; `declined` means the user dismissed it. */
  outcome: 'answered' | 'declined' | 'unavailable' | 'aborted'
}
```

`toToolResult` 里：

```ts
  const unanswered = (text: string, outcome: AskUserQuestionDetails['outcome']) => ({
    content: [{ type: 'text' as const, text }],
    details: { questions, answers: {}, outcome },
    isError: true
  })
  switch (response?.status) {
    case undefined:
      return unanswered(CANCELLED, 'aborted')
    case 'unavailable':
      return unanswered(UNAVAILABLE, 'unavailable')
    case 'declined': {
      const feedback = response.feedback?.trim()
      return unanswered(
        feedback ? `${DECLINED} They said:\n${feedback}` : `${DECLINED} Wait for the user's instructions instead of asking again.`,
        'declined'
      )
    }
    case 'answered': {
      const { answers, annotations } = response
      return {
        content: [{ type: 'text', text: answeredText(questions, response) }],
        details: { questions, answers, outcome: 'answered', ...(annotations === undefined ? {} : { annotations }) }
      }
    }
  }
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run --project agent-runtime packages/agent-runtime/tests/askUser.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/agent-runtime/src/askUserExtension.ts packages/agent-runtime/tests/askUser.test.ts
git commit -S --signoff -m "feat(agent-runtime): record how an AskUserQuestion call ended in its details"
```

---

### Task 2: `goalState.ts`：类型、迁移、校验

**Files:**
- Create: `packages/agent-runtime/src/goalState.ts`
- Test: `packages/agent-runtime/tests/goalState.test.ts`

**Interfaces:**
- Produces（后续任务全部依赖这些名字）：

```ts
export const GOAL_STATE_TYPE = 'cherry.goal'
export const GOAL_ROUND_TYPE = 'cherry.goal-round'
export const GOAL_NOTICE_TYPE = 'cherry.goal-notice'
export const MAX_OBJECTIVE_CHARS = 4000
export type GoalPhase = 'active' | 'paused' | 'blocked' | 'complete'
export type GoalStopCode = /* spec §5.2 的 16 个 */
export interface GoalBudget { tokens?: number; usd?: number }
export interface GoalStop { code: GoalStopCode; message?: string; at: number }
export interface GoalSnapshot { id; revision; objective; phase; roundsStarted; progressRounds; maxGoalRounds; budget?; tokensUsed; costUsed; wrapUpDone; lastStop?; createdAt; updatedAt }
export type GoalCleared = { id: string; revision: number; cleared: true; at: number }
export interface GoalLimits { maxGoalRounds: number; maxGoalRoundsCeiling: number; budget?: GoalBudget }
export class GoalError extends Error { code: 'invalid_objective' | 'invalid_limit' | 'stale_revision' | 'no_goal' | 'goal_exists' | 'not_human_turn' | 'no_capacity' | 'invalid_action' }
export function phaseForStop(code: GoalStopCode): GoalPhase
export function createGoal(objective: string, limits: GoalLimits, overrides: { maxGoalRounds?: number; budget?: GoalBudget }, now: number): GoalSnapshot
export function editGoal(goal: GoalSnapshot, patch: { objective?: string; maxGoalRounds?: number; budget?: GoalBudget }, ceiling: number, now: number): GoalSnapshot
export function stopGoal(goal: GoalSnapshot, stop: { code: GoalStopCode; message?: string }, now: number): GoalSnapshot
export function resumeGoal(goal: GoalSnapshot, now: number): GoalSnapshot
export function hasCapacity(goal: GoalSnapshot): boolean
export function budgetExceeded(goal: GoalSnapshot): boolean
export function admitRound(goal: GoalSnapshot, kind: 'work' | 'hint' | 'wrap-up', now: number): GoalSnapshot
export function recordUsage(goal: GoalSnapshot, usage: { tokens: number; usd: number }, progressed: boolean): GoalSnapshot
```

- [ ] **Step 1: 写失败的测试**

```ts
// packages/agent-runtime/tests/goalState.test.ts
import { describe, expect, it } from 'vitest'

import {
  admitRound,
  createGoal,
  editGoal,
  GoalError,
  hasCapacity,
  phaseForStop,
  recordUsage,
  resumeGoal,
  stopGoal
} from '../src/goalState'

const limits = { maxGoalRounds: 100, maxGoalRoundsCeiling: 1000 }

describe('goal state transitions', () => {
  it('creates an active goal with the default cap and trimmed objective', () => {
    const goal = createGoal('  Ship the migration  ', limits, {}, 1_000)
    expect(goal).toMatchObject({
      objective: 'Ship the migration',
      phase: 'active',
      revision: 1,
      roundsStarted: 0,
      progressRounds: 0,
      maxGoalRounds: 100,
      wrapUpDone: false,
      tokensUsed: 0,
      costUsed: 0
    })
  })

  it.each([
    ['', 'invalid_objective'],
    ['x'.repeat(4001), 'invalid_objective']
  ])('refuses objective %j', (objective, code) => {
    expect(() => createGoal(objective, limits, {}, 1)).toThrow(expect.objectContaining({ code }))
  })

  it('refuses a cap above the ceiling and a non-positive cap', () => {
    expect(() => createGoal('g', limits, { maxGoalRounds: 1001 }, 1)).toThrow(expect.objectContaining({ code: 'invalid_limit' }))
    expect(() => createGoal('g', limits, { maxGoalRounds: 0 }, 1)).toThrow(expect.objectContaining({ code: 'invalid_limit' }))
    expect(() => editGoal(createGoal('g', limits, {}, 1), { maxGoalRounds: 1001 }, 1000, 2)).toThrow(
      expect.objectContaining({ code: 'invalid_limit' })
    )
  })

  it('maps every stop code to the phase the spec assigns', () => {
    expect(phaseForStop('complete')).toBe('complete')
    for (const code of ['aborted', 'paused_by_user', 'paused_each_round'] as const) expect(phaseForStop(code)).toBe('paused')
    for (const code of [
      'model_blocked', 'round_limit', 'budget_exhausted', 'no_progress', 'approval_denied', 'awaiting_approval',
      'needs_user_input', 'waiting_children', 'provider_error', 'continuation_rejected', 'unsupported_model'
    ] as const)
      expect(phaseForStop(code)).toBe('blocked')
  })

  it('stops with the code, bumps the revision and keeps counters', () => {
    const goal = admitRound(createGoal('g', limits, {}, 1), 'work', 2)
    const stopped = stopGoal(goal, { code: 'no_progress' }, 3)
    expect(stopped).toMatchObject({ phase: 'blocked', revision: 3, roundsStarted: 1, lastStop: { code: 'no_progress', at: 3 } })
  })

  it('admits rounds up to the cap, marks the wrap-up, then reports no capacity', () => {
    let goal = createGoal('g', limits, { maxGoalRounds: 2 }, 1)
    goal = admitRound(goal, 'work', 2)
    expect(hasCapacity(goal)).toBe(true)
    goal = admitRound(goal, 'wrap-up', 3)
    expect(goal).toMatchObject({ roundsStarted: 2, wrapUpDone: true })
    expect(hasCapacity(goal)).toBe(false)
    expect(() => resumeGoal(stopGoal(goal, { code: 'round_limit' }, 4), 5)).toThrow(expect.objectContaining({ code: 'no_capacity' }))
  })

  it('raising the cap after round_limit re-activates the goal and clears the wrap-up flag', () => {
    let goal = admitRound(createGoal('g', limits, { maxGoalRounds: 1 }, 1), 'wrap-up', 2)
    goal = stopGoal(goal, { code: 'round_limit' }, 3)
    goal = editGoal(goal, { maxGoalRounds: 3 }, 1000, 4)
    expect(goal).toMatchObject({ phase: 'active', wrapUpDone: false, maxGoalRounds: 3 })
    expect(hasCapacity(goal)).toBe(true)
  })

  it('budget in tokens or usd ends capacity once crossed, and usage counts progress rounds', () => {
    let goal = createGoal('g', limits, { budget: { tokens: 50 } }, 1)
    goal = recordUsage(goal, { tokens: 30, usd: 0 }, true)
    expect(hasCapacity(goal)).toBe(true)
    goal = recordUsage(goal, { tokens: 30, usd: 0 }, false)
    expect(goal).toMatchObject({ tokensUsed: 60, progressRounds: 1 })
    expect(hasCapacity(goal)).toBe(false)
    const priced = recordUsage(createGoal('g', limits, { budget: { usd: 0.01 } }, 1), { tokens: 1, usd: 0.02 }, true)
    expect(hasCapacity(priced)).toBe(false)
  })

  it('resume only re-activates paused or blocked goals that still have capacity', () => {
    const paused = stopGoal(createGoal('g', limits, {}, 1), { code: 'paused_by_user' }, 2)
    expect(resumeGoal(paused, 3).phase).toBe('active')
    const done = stopGoal(createGoal('g', limits, {}, 1), { code: 'complete' }, 2)
    expect(() => resumeGoal(done, 3)).toThrow(expect.objectContaining({ code: 'invalid_action' }))
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run --project agent-runtime packages/agent-runtime/tests/goalState.test.ts`
Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现**

```ts
// packages/agent-runtime/src/goalState.ts
import { randomUUID } from 'node:crypto'

export const GOAL_STATE_TYPE = 'cherry.goal'
export const GOAL_ROUND_TYPE = 'cherry.goal-round'
/** Feedback of a `/goal` command for the UI; never sent to the model. */
export const GOAL_NOTICE_TYPE = 'cherry.goal-notice'
export const MAX_OBJECTIVE_CHARS = 4000

export type GoalPhase = 'active' | 'paused' | 'blocked' | 'complete'

export type GoalStopCode =
  | 'complete'
  | 'model_blocked'
  | 'round_limit'
  | 'budget_exhausted'
  | 'no_progress'
  | 'approval_denied'
  | 'awaiting_approval'
  | 'needs_user_input'
  | 'waiting_children'
  | 'provider_error'
  | 'aborted'
  | 'paused_by_user'
  | 'paused_each_round'
  | 'continuation_rejected'
  | 'unsupported_model'

export interface GoalBudget {
  tokens?: number
  usd?: number
}

export interface GoalStop {
  code: GoalStopCode
  message?: string
  at: number
}

export interface GoalSnapshot {
  id: string
  revision: number
  objective: string
  phase: GoalPhase
  roundsStarted: number
  /** Rounds in which a non-read tool call succeeded or the reply changed; the fallback completion check reads it. */
  progressRounds: number
  maxGoalRounds: number
  budget?: GoalBudget
  tokensUsed: number
  costUsed: number
  wrapUpDone: boolean
  lastStop?: GoalStop
  createdAt: number
  updatedAt: number
}

export type GoalCleared = { id: string; revision: number; cleared: true; at: number }

export interface GoalLimits {
  maxGoalRounds: number
  maxGoalRoundsCeiling: number
  budget?: GoalBudget
}

export type GoalErrorCode =
  | 'invalid_objective'
  | 'invalid_limit'
  | 'stale_revision'
  | 'no_goal'
  | 'goal_exists'
  | 'not_human_turn'
  | 'no_capacity'
  | 'invalid_action'

export class GoalError extends Error {
  constructor(
    readonly code: GoalErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'GoalError'
  }
}

const PAUSED_CODES = new Set<GoalStopCode>(['aborted', 'paused_by_user', 'paused_each_round'])

export function phaseForStop(code: GoalStopCode): GoalPhase {
  if (code === 'complete') return 'complete'
  return PAUSED_CODES.has(code) ? 'paused' : 'blocked'
}

function checkObjective(objective: string): string {
  const trimmed = objective.trim()
  if (trimmed.length === 0 || trimmed.length > MAX_OBJECTIVE_CHARS)
    throw new GoalError('invalid_objective', `objective must be 1-${MAX_OBJECTIVE_CHARS} characters`)
  return trimmed
}

function checkCap(cap: number, ceiling: number): number {
  if (!Number.isInteger(cap) || cap < 1 || cap > ceiling)
    throw new GoalError('invalid_limit', `max_goal_rounds must be an integer between 1 and ${ceiling}`)
  return cap
}

function checkBudget(budget: GoalBudget | undefined): GoalBudget | undefined {
  if (!budget) return undefined
  for (const value of [budget.tokens, budget.usd])
    if (value !== undefined && !(Number.isFinite(value) && value > 0))
      throw new GoalError('invalid_limit', 'budget values must be positive numbers')
  return budget.tokens === undefined && budget.usd === undefined ? undefined : budget
}

const bump = (goal: GoalSnapshot, now: number, patch: Partial<GoalSnapshot>): GoalSnapshot => ({
  ...goal,
  ...patch,
  revision: goal.revision + 1,
  updatedAt: now
})

export function createGoal(
  objective: string,
  limits: GoalLimits,
  overrides: { maxGoalRounds?: number; budget?: GoalBudget },
  now: number
): GoalSnapshot {
  const budget = checkBudget(overrides.budget ?? limits.budget)
  return {
    id: randomUUID(),
    revision: 1,
    objective: checkObjective(objective),
    phase: 'active',
    roundsStarted: 0,
    progressRounds: 0,
    maxGoalRounds: checkCap(overrides.maxGoalRounds ?? limits.maxGoalRounds, limits.maxGoalRoundsCeiling),
    ...(budget ? { budget } : {}),
    tokensUsed: 0,
    costUsed: 0,
    wrapUpDone: false,
    createdAt: now,
    updatedAt: now
  }
}

export function budgetExceeded(goal: GoalSnapshot): boolean {
  const { budget } = goal
  if (!budget) return false
  return (budget.tokens !== undefined && goal.tokensUsed >= budget.tokens) || (budget.usd !== undefined && goal.costUsed >= budget.usd)
}

export function hasCapacity(goal: GoalSnapshot): boolean {
  return goal.roundsStarted < goal.maxGoalRounds && !budgetExceeded(goal)
}

/** Raising a limit re-opens a goal the limit closed; the caller still has to resume (arm) it. */
export function editGoal(
  goal: GoalSnapshot,
  patch: { objective?: string; maxGoalRounds?: number; budget?: GoalBudget },
  ceiling: number,
  now: number
): GoalSnapshot {
  const next: Partial<GoalSnapshot> = {}
  if (patch.objective !== undefined) next.objective = checkObjective(patch.objective)
  if (patch.maxGoalRounds !== undefined) next.maxGoalRounds = checkCap(patch.maxGoalRounds, ceiling)
  if (patch.budget !== undefined) next.budget = checkBudget({ ...goal.budget, ...patch.budget })
  const edited = bump(goal, now, next)
  const raised = edited.maxGoalRounds > goal.maxGoalRounds || (goal.budget !== undefined && !budgetExceeded(edited) && budgetExceeded(goal))
  if (!raised) return edited
  const closedByLimit = goal.phase === 'blocked' && (goal.lastStop?.code === 'round_limit' || goal.lastStop?.code === 'budget_exhausted')
  return { ...edited, wrapUpDone: false, ...(closedByLimit ? { phase: 'active' as const } : {}) }
}

export function stopGoal(goal: GoalSnapshot, stop: { code: GoalStopCode; message?: string }, now: number): GoalSnapshot {
  return bump(goal, now, { phase: phaseForStop(stop.code), lastStop: { ...stop, at: now } })
}

export function resumeGoal(goal: GoalSnapshot, now: number): GoalSnapshot {
  if (goal.phase === 'complete') throw new GoalError('invalid_action', 'the goal is complete; create a new one')
  if (!hasCapacity(goal)) throw new GoalError('no_capacity', 'raise max_goal_rounds or the budget before resuming')
  return goal.phase === 'active' ? goal : bump(goal, now, { phase: 'active' })
}

export function admitRound(goal: GoalSnapshot, kind: 'work' | 'hint' | 'wrap-up', now: number): GoalSnapshot {
  return bump(goal, now, { roundsStarted: goal.roundsStarted + 1, ...(kind === 'wrap-up' ? { wrapUpDone: true } : {}) })
}

/** Usage of one goal round; no revision bump, the next snapshot carries it. */
export function recordUsage(goal: GoalSnapshot, usage: { tokens: number; usd: number }, progressed: boolean): GoalSnapshot {
  return {
    ...goal,
    tokensUsed: goal.tokensUsed + usage.tokens,
    costUsed: goal.costUsed + usage.usd,
    progressRounds: goal.progressRounds + (progressed ? 1 : 0)
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run --project agent-runtime packages/agent-runtime/tests/goalState.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/agent-runtime/src/goalState.ts packages/agent-runtime/tests/goalState.test.ts
git commit -S --signoff -m "feat(agent-runtime): add goal state transitions and limits"
```

---

### Task 3: `goalState.ts`：读 branch、进展判定、提示词

**Files:**
- Modify: `packages/agent-runtime/src/goalState.ts`
- Test: `packages/agent-runtime/tests/goalState.test.ts`

**Interfaces:**
- Produces：

```ts
export interface RoundDetails { goalId: string; revision: number; round: number; kind: 'work' | 'hint' | 'wrap-up' }
export const NON_PROGRESS_TOOLS: ReadonlySet<string>
export function currentGoal(entries: readonly SessionEntry[]): GoalSnapshot | undefined
export function isHumanTurn(entries: readonly SessionEntry[]): boolean
export function tailRound(entries: readonly SessionEntry[]): RoundDetails | undefined
export function assistantText(message: AssistantMessage): string
export function turnProgress(message: AssistantMessage, toolResults: readonly ToolResultMessage[], previousText: string | undefined): boolean
export function toolCallKey(toolName: string, input: unknown): string
export function renderRoundPrompt(goal: GoalSnapshot, details: RoundDetails, blockedAfter: number, noProgressRounds: number): string
export function goalView(goal: GoalSnapshot | undefined, armed: boolean): { goal: null } | { goal: Omit<GoalSnapshot, 'wrapUpDone'>; activation: 'armed' | 'disarmed' }
```

- [ ] **Step 1: 写失败的测试**

追加到 `tests/goalState.test.ts`：

```ts
import type { SessionEntry } from '@earendil-works/pi-coding-agent'
import {
  currentGoal, isHumanTurn, tailRound, turnProgress, toolCallKey, renderRoundPrompt, goalView,
  GOAL_ROUND_TYPE, GOAL_STATE_TYPE
} from '../src/goalState'

const base = (id: string) => ({ id, parentId: null, timestamp: new Date(1).toISOString() })
const userEntry = (id: string, text: string): SessionEntry => ({ ...base(id), type: 'message', message: { role: 'user', content: text, timestamp: 1 } })
const assistantEntry = (id: string, text: string): SessionEntry => ({
  ...base(id), type: 'message',
  message: { role: 'assistant', content: [{ type: 'text', text }], api: 'x', provider: 'x', model: 'x', usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: 'stop', timestamp: 1 }
})
const roundEntry = (id: string, round: number): SessionEntry => ({
  ...base(id), type: 'custom_message', customType: GOAL_ROUND_TYPE, content: 'go', display: false,
  details: { goalId: 'g1', revision: 2, round, kind: 'work' }
})
const stateEntry = (id: string, data: unknown): SessionEntry => ({ ...base(id), type: 'custom', customType: GOAL_STATE_TYPE, data })

describe('goal branch reading', () => {
  const goal = createGoal('g', limits, {}, 1)

  it('returns the last snapshot and nothing after a clear tombstone', () => {
    expect(currentGoal([stateEntry('a', goal), stateEntry('b', { ...goal, revision: 2, phase: 'paused' })])).toMatchObject({ revision: 2, phase: 'paused' })
    expect(currentGoal([stateEntry('a', goal), stateEntry('b', { id: goal.id, revision: 3, cleared: true, at: 2 })])).toBeUndefined()
    expect(currentGoal([userEntry('u', 'hi')])).toBeUndefined()
  })

  it('tells a human turn from a goal round by the last user-side entry', () => {
    expect(isHumanTurn([userEntry('u', 'do it'), assistantEntry('a', 'ok')])).toBe(true)
    expect(isHumanTurn([userEntry('u', 'do it'), assistantEntry('a', 'ok'), roundEntry('r', 1), assistantEntry('b', 'working')])).toBe(false)
    expect(isHumanTurn([roundEntry('r', 1), assistantEntry('b', 'working'), userEntry('u2', 'stop'), assistantEntry('c', 'ok')])).toBe(true)
  })

  it('reads a round only when it is the branch tail', () => {
    expect(tailRound([userEntry('u', 'x'), roundEntry('r', 3)])).toMatchObject({ round: 3, goalId: 'g1' })
    expect(tailRound([roundEntry('r', 3), assistantEntry('a', 'y')])).toBeUndefined()
  })
})

describe('progress and prompts', () => {
  const assistant = (text: string) => assistantEntry('a', text).message as any
  const result = (toolName: string, isError = false) => ({ role: 'toolResult', toolCallId: 'c', toolName, content: [], isError, timestamp: 1 }) as any

  it('counts a successful non-read tool call or a changed reply as progress', () => {
    expect(turnProgress(assistant('same'), [result('read')], 'same')).toBe(false)
    expect(turnProgress(assistant('same'), [result('todo_write')], 'same')).toBe(false)
    expect(turnProgress(assistant('same'), [result('edit', true)], 'same')).toBe(false)
    expect(turnProgress(assistant('same'), [result('edit')], 'same')).toBe(true)
    expect(turnProgress(assistant('different now'), [], 'same')).toBe(true)
    expect(turnProgress(assistant('  same \n'), [], 'same')).toBe(false)
  })

  it('keys tool calls by name and argument content, not object key order', () => {
    expect(toolCallKey('read', { path: 'a', offset: 1 })).toBe(toolCallKey('read', { offset: 1, path: 'a' }))
    expect(toolCallKey('read', { path: 'a' })).not.toBe(toolCallKey('read', { path: 'b' }))
  })

  it('renders the objective as untrusted data with round, cap and the blocked threshold', () => {
    const goal = createGoal('Fix <docs>', limits, { maxGoalRounds: 5 }, 1)
    const text = renderRoundPrompt(goal, { goalId: goal.id, revision: 1, round: 2, kind: 'work' }, 3, 0)
    expect(text).toContain('<untrusted_objective>Fix <docs></untrusted_objective>')
    expect(text).toContain('Round: 2/5')
    expect(text).toContain('3 consecutive')
    expect(renderRoundPrompt(goal, { goalId: goal.id, revision: 1, round: 3, kind: 'hint' }, 3, 2)).toMatch(/previous 2 rounds made no observable progress/)
    expect(renderRoundPrompt(goal, { goalId: goal.id, revision: 1, round: 5, kind: 'wrap-up' }, 3, 0)).toMatch(/Do not start new work/)
  })

  it('exposes the view the tools return', () => {
    expect(goalView(undefined, false)).toEqual({ goal: null })
    const view = goalView(createGoal('g', limits, {}, 1), true)
    expect(view).toMatchObject({ activation: 'armed', goal: { objective: 'g', phase: 'active' } })
    expect('wrapUpDone' in (view as any).goal).toBe(false)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run --project agent-runtime packages/agent-runtime/tests/goalState.test.ts`
Expected: FAIL，函数未导出。

- [ ] **Step 3: 实现**

追加到 `goalState.ts`：

```ts
import type { AssistantMessage, ToolResultMessage } from '@earendil-works/pi-ai'
import type { SessionEntry } from '@earendil-works/pi-coding-agent'

export interface RoundDetails {
  goalId: string
  revision: number
  round: number
  kind: 'work' | 'hint' | 'wrap-up'
}

/** Calls that read or bookkeep; a round made only of these has not moved the objective. */
export const NON_PROGRESS_TOOLS: ReadonlySet<string> = new Set([
  'read', 'grep', 'find', 'ls', 'tool_search', 'vcc_recall', 'get_goal', 'todo_write', 'AskUserQuestion'
])

const isGoalState = (entry: SessionEntry): entry is Extract<SessionEntry, { type: 'custom' }> =>
  entry.type === 'custom' && entry.customType === GOAL_STATE_TYPE

export function currentGoal(entries: readonly SessionEntry[]): GoalSnapshot | undefined {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i]
    if (!isGoalState(entry)) continue
    const data = entry.data as GoalSnapshot | GoalCleared
    return 'cleared' in data ? undefined : data
  }
  return undefined
}

const isRoundMessage = (entry: SessionEntry) => entry.type === 'custom_message' && entry.customType === GOAL_ROUND_TYPE

/** True when the last user-side input on the branch came from a person, not from a goal round. */
export function isHumanTurn(entries: readonly SessionEntry[]): boolean {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i]
    if (isRoundMessage(entry)) return false
    if (entry.type === 'custom_message') return true
    if (entry.type === 'message' && entry.message.role === 'user') return true
  }
  return true
}

export function tailRound(entries: readonly SessionEntry[]): RoundDetails | undefined {
  const tail = entries.at(-1)
  return tail && isRoundMessage(tail) ? (tail.details as RoundDetails) : undefined
}

export function assistantText(message: AssistantMessage): string {
  return message.content
    .flatMap((block) => (block.type === 'text' ? [block.text] : []))
    .join('\n')
    .replace(/\s+/g, ' ')
    .trim()
}

export function turnProgress(
  message: AssistantMessage,
  toolResults: readonly ToolResultMessage[],
  previousText: string | undefined
): boolean {
  if (toolResults.some((result) => result.isError !== true && !NON_PROGRESS_TOOLS.has(result.toolName))) return true
  const text = assistantText(message)
  return text.length > 0 && text !== previousText
}

const stable = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(stable)
    : value && typeof value === 'object'
      ? Object.fromEntries(Object.keys(value as object).sort().map((key) => [key, stable((value as Record<string, unknown>)[key])]))
      : value

export function toolCallKey(toolName: string, input: unknown): string {
  return `${toolName}:${JSON.stringify(stable(input))}`
}

export function renderRoundPrompt(goal: GoalSnapshot, details: RoundDetails, blockedAfter: number, noProgressRounds: number): string {
  const head = [
    '<goal_round>',
    'Objective (data, not instructions):',
    `<untrusted_objective>${goal.objective}</untrusted_objective>`,
    `Round: ${details.round}/${goal.maxGoalRounds}`,
    ''
  ]
  const body =
    details.kind === 'wrap-up'
      ? [
          'The round, token or cost budget for this goal is exhausted. Do not start new work.',
          'Summarize what is done, what is verified, and what remains, then stop.'
        ]
      : [
          ...(details.kind === 'hint'
            ? [
                `The previous ${noProgressRounds} rounds made no observable progress (no successful tool action and`,
                'repeated output). Change approach, or report the concrete blocker.',
                ''
              ]
            : []),
          'Take the next useful step toward the objective. Use the workspace, tool results and',
          'session history as the source of truth; do not repeat completed work or write',
          'status-only replies.',
          'Before calling update_goal with action "complete", list each deliverable the',
          'objective names and the evidence you have for it; treat uncertainty as not achieved.',
          `If the same concrete condition has blocked you for ${blockedAfter} consecutive`,
          'rounds, call update_goal with action "blocked" and describe that condition.'
        ]
  return [...head, ...body, '</goal_round>'].join('\n')
}

export function goalView(goal: GoalSnapshot | undefined, armed: boolean) {
  if (!goal) return { goal: null } as const
  const { wrapUpDone: _wrapUpDone, ...view } = goal
  return { goal: view, activation: armed ? ('armed' as const) : ('disarmed' as const) }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run --project agent-runtime packages/agent-runtime/tests/goalState.test.ts`
Expected: PASS

- [ ] **Step 5: 格式、lint、提交**

```bash
pnpm exec oxfmt --write packages/agent-runtime/src/goalState.ts packages/agent-runtime/tests/goalState.test.ts
pnpm exec oxlint --deny-warnings packages/agent-runtime/src/goalState.ts packages/agent-runtime/tests/goalState.test.ts
git add packages/agent-runtime/src/goalState.ts packages/agent-runtime/tests/goalState.test.ts
git commit -S --signoff -m "feat(agent-runtime): read goal state from the branch and render round prompts"
```

---

### Task 4: 扩展骨架：工具、命令、恢复

**Files:**
- Create: `packages/agent-runtime/src/goalExtension.ts`
- Create: `packages/agent-runtime/tests/goalSupport.ts`
- Create: `packages/agent-runtime/tests/goal.test.ts`
- Modify: `packages/agent-runtime/src/index.ts`

**Interfaces:**
- Consumes：任务 2、3 的全部导出；L3 的 `AgentToolResult`、`ExtensionFactory` 用法。
- Produces：

```ts
export interface GoalApprovalEvent { kind: 'pending' | 'granted' | 'denied' | 'unavailable'; toolCallId: string }
export interface GoalVerifier { verify(input: { objective: string; claim: { evidence?: string }; messages: ConversationModelMessage[]; signal: AbortSignal }): Promise<{ verdict: 'met' | 'not_met' | 'impossible'; reason: string }> }
export interface GoalPort {
  defaults: { maxGoalRounds: number; maxGoalRoundsCeiling: number; budget?: GoalBudget; blockedAfter: number; autonomy: () => 'auto' | 'confirm-each-round' }
  modelSupportsTools(): boolean
  onApproval?(listener: (event: GoalApprovalEvent) => void): () => void
  hasRunningChildren?(): boolean
  verify?: GoalVerifier
}
export const GOAL_TOOL_NAMES = ['get_goal', 'create_goal', 'update_goal'] as const
export function createGoalExtension(port: GoalPort): ExtensionFactory
```

本任务只实现：`session_start` 恢复、三个工具（含权限和 CAS）、`/goal` 命令的 status / create / edit / pause / clear / rounds / budget（resume 在任务 5 和续跑一起做）。续跑、计数、停止请求在后续任务加到同一个文件里。

- [ ] **Step 1: 写测试助手**

```ts
// packages/agent-runtime/tests/goalSupport.ts
import type { LanguageModelV3CallOptions, LanguageModelV3Prompt, LanguageModelV3StreamPart } from '@ai-sdk/provider'
import { simulateReadableStream } from 'ai'
import { MockLanguageModelV3 } from 'ai/test'

import {
  GOAL_NOTICE_TYPE,
  GOAL_ROUND_TYPE,
  GOAL_STATE_TYPE,
  type GoalPort,
  type GoalSnapshot,
  type TranscriptEntry
} from '../src'
import { finish } from './support'

export function goalPort(overrides: Partial<GoalPort> & { defaults?: Partial<GoalPort['defaults']> } = {}): GoalPort {
  return {
    modelSupportsTools: () => true,
    ...overrides,
    defaults: {
      maxGoalRounds: 100,
      maxGoalRoundsCeiling: 1000,
      blockedAfter: 3,
      autonomy: () => 'auto',
      ...overrides.defaults
    }
  }
}

/** The goal view the model last read, parsed from the newest goal-tool result in the prompt. */
export function readGoal(prompt: LanguageModelV3Prompt): { goal: GoalSnapshot | null; activation?: string } {
  for (let i = prompt.length - 1; i >= 0; i--) {
    const message = prompt[i]
    if (message.role !== 'tool') continue
    for (const part of message.content) {
      if (part.type !== 'tool-result' || !['get_goal', 'create_goal', 'update_goal'].includes(part.toolName)) continue
      const output = part.output as { type: string; value: unknown }
      if (output.type === 'text') return JSON.parse(output.value as string)
    }
  }
  return { goal: null }
}

export const toolCall = (id: string, toolName: string, input: object): LanguageModelV3StreamPart => ({
  type: 'tool-call',
  toolCallId: id,
  toolName,
  input: JSON.stringify(input)
})

/**
 * A model whose Nth call runs the Nth script with the prompt; scripts may read the goal the model
 * last saw. The last script repeats.
 */
export function goalModel(scripts: ((prompt: LanguageModelV3Prompt, call: number) => LanguageModelV3StreamPart[])[]) {
  const calls: LanguageModelV3CallOptions[] = []
  const model = new MockLanguageModelV3({
    doStream: async (options) => {
      calls.push(options)
      const script = scripts[Math.min(calls.length - 1, scripts.length - 1)]
      return { stream: simulateReadableStream({ chunks: script(options.prompt, calls.length) }) }
    }
  })
  return { model, calls }
}

export const say = (text: string): LanguageModelV3StreamPart[] => [
  { type: 'text-start', id: 't' },
  { type: 'text-delta', id: 't', delta: text },
  { type: 'text-end', id: 't' },
  finish('stop')
]

export const snapshots = (entries: readonly TranscriptEntry[]): GoalSnapshot[] =>
  entries.flatMap((entry) => (entry.kind === 'state' && entry.type === GOAL_STATE_TYPE && !(entry.data as any)?.cleared ? [entry.data as GoalSnapshot] : []))

export const lastSnapshot = (entries: readonly TranscriptEntry[]) => snapshots(entries).at(-1)

export const rounds = (entries: readonly TranscriptEntry[]) =>
  entries.flatMap((entry) => (entry.kind === 'message' && entry.custom?.type === GOAL_ROUND_TYPE ? [entry.custom.details as { round: number; kind: string }] : []))

export const notices = (entries: readonly TranscriptEntry[]) =>
  entries.flatMap((entry) => (entry.kind === 'state' && entry.type === GOAL_NOTICE_TYPE ? [(entry.data as { text: string }).text] : []))
```

- [ ] **Step 2: 写失败的测试**

```ts
// packages/agent-runtime/tests/goal.test.ts
import { describe, expect, it } from 'vitest'

import { createGoalExtension } from '../src'
import { goalModel, goalPort, lastSnapshot, notices, readGoal, say, snapshots, toolCall } from './goalSupport'
import { createTestSession, finish, hostStore, streamTextPort } from './support'
import { textOf, toolResults } from './toolResults'

async function session(scripts: Parameters<typeof goalModel>[0], port = goalPort()) {
  const { model, calls } = goalModel(scripts)
  const host = hostStore()
  const runtime = await createTestSession({
    port: streamTextPort(model).port,
    extensionFactories: [createGoalExtension(port)],
    onEvent: host.onEvent
  })
  return { ...runtime, calls, host }
}

describe('goal tools', () => {
  it('lets the model create a goal in a human turn and read it back with the same id', async () => {
    const { session: s, host, calls } = await session([
      () => [toolCall('c1', 'create_goal', { objective: 'Ship the docs gate', max_goal_rounds: 5 }), finish('tool-calls')],
      () => [toolCall('c2', 'get_goal', {}), finish('tool-calls')],
      () => say('Started.')
    ])
    await s.prompt('Please make every docs gate pass')

    const created = readGoal(calls[1].prompt)
    const read = readGoal(calls[2].prompt)
    expect(created.goal).toMatchObject({ objective: 'Ship the docs gate', maxGoalRounds: 5, phase: 'active', revision: 1 })
    expect(read.goal?.id).toBe(created.goal?.id)
    expect(snapshots(host.entries).at(0)).toMatchObject({ objective: 'Ship the docs gate' })
  })

  it('rejects a stale revision and returns the current view instead of applying the change', async () => {
    const { session: s, calls } = await session([
      () => [toolCall('c1', 'create_goal', { objective: 'g' }), finish('tool-calls')],
      (prompt) => [toolCall('c2', 'update_goal', { goal_id: readGoal(prompt).goal!.id, revision: 1, action: 'edit', objective: 'g2' }), finish('tool-calls')],
      (prompt) => [toolCall('c3', 'update_goal', { goal_id: readGoal(prompt).goal!.id, revision: 1, action: 'complete', evidence: 'done' }), finish('tool-calls')],
      () => say('ok')
    ])
    await s.prompt('go')

    const [, , stale] = toolResults(s)
    expect(stale.isError).toBe(true)
    expect(textOf(stale)).toMatch(/stale/i)
    expect(readGoal(calls[3].prompt).goal).toMatchObject({ revision: 2, objective: 'g2', phase: 'active' })
  })

  it('refuses a second goal while one is unfinished and allows it after completion', async () => {
    const { session: s } = await session([
      () => [toolCall('c1', 'create_goal', { objective: 'first' }), finish('tool-calls')],
      () => [toolCall('c2', 'create_goal', { objective: 'second' }), finish('tool-calls')],
      () => say('ok')
    ])
    await s.prompt('go')
    const [, second] = toolResults(s)
    expect(second.isError).toBe(true)
    expect(textOf(second)).toMatch(/already/i)
  })

  it('treats empty strings and zero as omitted optional fields', async () => {
    const { session: s, calls } = await session([
      () => [toolCall('c1', 'create_goal', { objective: 'g', max_goal_rounds: 0, budget_tokens: 0 }), finish('tool-calls')],
      () => say('ok')
    ])
    await s.prompt('go')
    expect(readGoal(calls[1].prompt).goal).toMatchObject({ maxGoalRounds: 100 })
    expect(readGoal(calls[1].prompt).goal?.budget).toBeUndefined()
  })
})

describe('/goal command', () => {
  it('answers control words and edits with a notice when no goal exists, without a model turn', async () => {
    const port = goalPort()
    const host = hostStore()
    const { model } = goalModel([() => say('unused')])
    const { session: s } = await createTestSession({
      port: streamTextPort(model).port,
      extensionFactories: [createGoalExtension(port)],
      onEvent: host.onEvent
    })
    // Commands execute without a model request; continuation is wired in Task 5, so autonomy
    // is irrelevant here: a command that arms the goal pauses it again before any model call.
    await s.prompt('/goal pause')
    expect(notices(host.entries).at(-1)).toMatch(/no goal/i)

    await s.prompt('/goal edit nothing')
    expect(notices(host.entries).at(-1)).toMatch(/no goal/i)

    await s.prompt('/goal rounds 2000')
    expect(notices(host.entries).at(-1)).toMatch(/no goal/i)

    await s.prompt('/goal')
    expect(notices(host.entries).at(-1)).toMatch(/no goal/i)
  })

  it('reports a cap above the ceiling and an empty objective as errors', async () => {
    const host = hostStore()
    const { model } = goalModel([() => say('unused')])
    const { session: s } = await createTestSession({
      port: streamTextPort(model).port,
      extensionFactories: [createGoalExtension(goalPort({ defaults: { autonomy: () => 'confirm-each-round' } }))],
      onEvent: host.onEvent
    })
    await s.prompt('/goal Fix it')
    expect(lastSnapshot(host.entries)).toMatchObject({ objective: 'Fix it', phase: expect.any(String) })
    await s.prompt('/goal rounds 2000')
    expect(notices(host.entries).at(-1)).toMatch(/between 1 and 1000/)
    await s.prompt('/goal edit    ')
    expect(notices(host.entries).at(-1)).toMatch(/1-4000/)
  })
})
```

- [ ] **Step 3: 跑测试确认失败**

Run: `pnpm exec vitest run --project agent-runtime packages/agent-runtime/tests/goal.test.ts`
Expected: FAIL，`createGoalExtension` 未导出。

- [ ] **Step 4: 实现扩展骨架**

```ts
// packages/agent-runtime/src/goalExtension.ts
import { StringEnum, Type } from '@earendil-works/pi-ai'
import {
  type AgentToolResult,
  convertToLlm,
  type ExtensionContext,
  type ExtensionFactory,
  type SessionEntry
} from '@earendil-works/pi-coding-agent'

import type { ConversationModelMessage } from './modelMessages'
import { toModelMessages } from './modelMessages'
import {
  admitRound,
  createGoal,
  currentGoal,
  editGoal,
  GOAL_NOTICE_TYPE,
  GOAL_ROUND_TYPE,
  GOAL_STATE_TYPE,
  type GoalBudget,
  GoalError,
  type GoalSnapshot,
  type GoalStopCode,
  goalView,
  hasCapacity,
  isHumanTurn,
  recordUsage,
  renderRoundPrompt,
  resumeGoal,
  type RoundDetails,
  stopGoal,
  tailRound,
  toolCallKey,
  turnProgress
} from './goalState'

export interface GoalApprovalEvent {
  kind: 'pending' | 'granted' | 'denied' | 'unavailable'
  toolCallId: string
}

/** Host-side completion check; without it the extension falls back to runtime checks (spec §9). */
export interface GoalVerifier {
  verify(input: {
    objective: string
    claim: { evidence?: string }
    /** Recent conversation after the session model's replay rules, like the compaction summarizer's input. */
    messages: ConversationModelMessage[]
    signal: AbortSignal
  }): Promise<{ verdict: 'met' | 'not_met' | 'impossible'; reason: string }>
}

export interface GoalPort {
  defaults: {
    maxGoalRounds: number
    maxGoalRoundsCeiling: number
    budget?: GoalBudget
    blockedAfter: number
    /** Read at every decision, so the host may change it while a goal runs. */
    autonomy: () => 'auto' | 'confirm-each-round'
  }
  modelSupportsTools(): boolean
  /** L4: approval events of this session's tool calls. */
  onApproval?(listener: (event: GoalApprovalEvent) => void): () => void
  /** L4: background subagents of this session still running. */
  hasRunningChildren?(): boolean
  verify?: GoalVerifier
}

export const GOAL_TOOL_NAMES = ['get_goal', 'create_goal', 'update_goal'] as const

const ACTIONS = ['edit', 'pause', 'resume', 'complete', 'blocked'] as const
const CONTROL_WORDS = new Set(['pause', 'resume', 'clear'])
/** Messages handed to the verifier: the last rounds the model saw. */
const VERIFY_MESSAGES = 40

const text = (value: string) => ({ type: 'text' as const, text: value })
const hasText = (value: string | undefined): value is string => typeof value === 'string' && value.trim().length > 0
const hasNumber = (value: number | undefined): value is number => typeof value === 'number' && value > 0

const createParams = Type.Object({
  objective: Type.String({ description: 'The concrete completion objective from the direct human request.' }),
  max_goal_rounds: Type.Optional(Type.Number({ description: 'Round cap for this goal; omit for the default.' })),
  budget_tokens: Type.Optional(Type.Number({ description: 'Token budget for this goal; omit for none.' })),
  budget_usd: Type.Optional(Type.Number({ description: 'Cost budget in USD for this goal; omit for none.' }))
})

const updateParams = Type.Object({
  goal_id: Type.String({ description: 'Exact id from a prior get_goal.' }),
  revision: Type.Number({ description: 'Exact revision from a prior get_goal.' }),
  action: StringEnum(ACTIONS, {
    description:
      'edit | pause | resume | complete | blocked. complete only when the objective is achieved; blocked only after the same condition persisted for the configured consecutive rounds.'
  }),
  objective: Type.Optional(Type.String({ description: 'Replacement objective; valid only with action edit.' })),
  max_goal_rounds: Type.Optional(Type.Number({ description: 'New round cap; valid only with action edit.' })),
  budget_tokens: Type.Optional(Type.Number({ description: 'New token budget; valid only with action edit.' })),
  budget_usd: Type.Optional(Type.Number({ description: 'New USD budget; valid only with action edit.' })),
  blocked_reason: Type.Optional(Type.String({ description: 'The concrete blocking condition; required with action blocked.' })),
  evidence: Type.Optional(Type.String({ description: 'What proves each deliverable is done; required with action complete.' }))
})

interface Runtime {
  goal: GoalSnapshot | undefined
  armed: boolean
  ctx: ExtensionContext | undefined
  /** The turn(s) since the last admitted round belong to a goal round. */
  inGoalRound: boolean
  reservation: RoundDetails | undefined
  noProgressRounds: number
  previousText: string | undefined
  repeat: { key: string | undefined; count: number }
  stopRequest: { code: GoalStopCode; message?: string } | undefined
  blockedRounds: { revision: number; rounds: Set<number> }
  /** Usage since the last snapshot write; folded into the next one. */
  pendingUsage: { tokens: number; usd: number }
  /** Whether any turn of the current round progressed; undefined until its first turn ends. */
  lastRoundProgressed: boolean | undefined
}

/**
 * The goal extension: a persisted objective the runtime keeps pushing while the model is idle,
 * with every stop decided here (spec §1). Host-facing behavior comes in through `port`.
 */
export function createGoalExtension(port: GoalPort): ExtensionFactory {
  return (pi) => {
    if (!port.modelSupportsTools()) return

    const runtime: Runtime = {
      goal: undefined,
      armed: false,
      ctx: undefined,
      inGoalRound: false,
      reservation: undefined,
      noProgressRounds: 0,
      previousText: undefined,
      repeat: { key: undefined, count: 0 },
      stopRequest: undefined,
      blockedRounds: { revision: 0, rounds: new Set() },
      pendingUsage: { tokens: 0, usd: 0 },
      lastRoundProgressed: undefined
    }
    const limits = () => ({
      maxGoalRounds: port.defaults.maxGoalRounds,
      maxGoalRoundsCeiling: port.defaults.maxGoalRoundsCeiling,
      budget: port.defaults.budget
    })
    const now = () => Date.now()
    const branch = (): SessionEntry[] => runtime.ctx?.sessionManager.getBranch() ?? []

    /** Every persisted change goes through here; pending usage rides along. */
    const commit = (next: GoalSnapshot) => {
      const withUsage = recordUsage(next, runtime.pendingUsage, false)
      runtime.pendingUsage = { tokens: 0, usd: 0 }
      runtime.goal = withUsage
      pi.appendEntry(GOAL_STATE_TYPE, withUsage)
    }
    const stop = (code: GoalStopCode, message?: string) => {
      if (!runtime.goal) return
      runtime.armed = false
      commit(stopGoal(runtime.goal, { code, message }, now()))
    }
    const clear = () => {
      if (!runtime.goal) return
      pi.appendEntry(GOAL_STATE_TYPE, { id: runtime.goal.id, revision: runtime.goal.revision + 1, cleared: true, at: now() })
      runtime.goal = undefined
      runtime.armed = false
    }
    const notice = (value: string, level: 'info' | 'error' = 'info') => pi.appendEntry(GOAL_NOTICE_TYPE, { text: value, level })

    const requireGoal = (): GoalSnapshot => {
      if (!runtime.goal) throw new GoalError('no_goal', 'No goal is set.')
      return runtime.goal
    }
    const requireRevision = (goalId: string, revision: number): GoalSnapshot => {
      const goal = requireGoal()
      if (goal.id !== goalId || goal.revision !== revision)
        throw new GoalError('stale_revision', `Stale goal reference; current view: ${JSON.stringify(goalView(goal, runtime.armed))}`)
      return goal
    }
    const requireHumanTurn = (what: string) => {
      if (!isHumanTurn(branch())) throw new GoalError('not_human_turn', `${what} needs a direct human request in this turn.`)
    }
    const budgetFrom = (params: { budget_tokens?: number; budget_usd?: number }): GoalBudget | undefined => {
      const budget: GoalBudget = {}
      if (hasNumber(params.budget_tokens)) budget.tokens = params.budget_tokens
      if (hasNumber(params.budget_usd)) budget.usd = params.budget_usd
      return budget.tokens === undefined && budget.usd === undefined ? undefined : budget
    }
    const ok = (): AgentToolResult<unknown> => ({ content: [text(JSON.stringify(goalView(runtime.goal, runtime.armed)))], details: undefined })
    const fail = (error: unknown): AgentToolResult<unknown> => ({
      content: [text(error instanceof Error ? error.message : String(error))],
      details: undefined,
      isError: true
    })
    const guarded = (run: () => AgentToolResult<unknown> | Promise<AgentToolResult<unknown>>) => async () => {
      try {
        return await run()
      } catch (error) {
        return fail(error)
      }
    }

    pi.on('session_start', (_event, ctx) => {
      runtime.ctx = ctx
      runtime.goal = currentGoal(ctx.sessionManager.getBranch())
      runtime.armed = false
      runtime.inGoalRound = false
    })

    pi.registerTool({
      name: 'get_goal',
      label: 'Goal',
      description: 'Read the current goal, or { goal: null } when none is set. Call it before update_goal and copy its id and revision.',
      parameters: Type.Object({}),
      exposure: 'model-only',
      executionMode: 'sequential',
      annotations: { readOnlyHint: true, openWorldHint: false },
      execute: guarded(() => ok())
    })

    pi.registerTool({
      name: 'create_goal',
      label: 'Create goal',
      description:
        'Create a persisted goal that keeps this session working across automatic rounds. Only for a long-running objective the user asked for directly; not for single-turn work.',
      parameters: createParams,
      exposure: 'model-only',
      executionMode: 'sequential',
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      execute: (_id, params) =>
        guarded(() => {
          requireHumanTurn('create_goal')
          if (runtime.goal && runtime.goal.phase !== 'complete') throw new GoalError('goal_exists', 'A goal is already set; edit, pause or clear it first.')
          commit(createGoal(params.objective, limits(), { maxGoalRounds: hasNumber(params.max_goal_rounds) ? params.max_goal_rounds : undefined, budget: budgetFrom(params) }, now()))
          runtime.armed = true
          return ok()
        })()
    })

    pi.registerTool({
      name: 'update_goal',
      label: 'Update goal',
      description: 'Edit, pause, resume, complete or block the current goal. Copy goal_id and revision from get_goal.',
      parameters: updateParams,
      exposure: 'model-only',
      executionMode: 'sequential',
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      execute: (_id, params, signal) =>
        guarded(async () => {
          const goal = requireRevision(params.goal_id, params.revision)
          const extras = hasText(params.objective) || hasNumber(params.max_goal_rounds) || hasNumber(params.budget_tokens) || hasNumber(params.budget_usd)
          if (params.action !== 'edit' && extras) throw new GoalError('invalid_action', 'objective and limits are valid only with action edit')
          if (params.action !== 'blocked' && hasText(params.blocked_reason)) throw new GoalError('invalid_action', 'blocked_reason is valid only with action blocked')
          switch (params.action) {
            case 'edit':
              requireHumanTurn('edit')
              commit(editGoal(goal, { objective: hasText(params.objective) ? params.objective : undefined, maxGoalRounds: hasNumber(params.max_goal_rounds) ? params.max_goal_rounds : undefined, budget: budgetFrom(params) }, port.defaults.maxGoalRoundsCeiling, now()))
              return ok()
            case 'pause':
              requireHumanTurn('pause')
              stop('paused_by_user')
              return ok()
            case 'resume':
              requireHumanTurn('resume')
              commit(resumeGoal(goal, now()))
              runtime.armed = true
              return ok()
            case 'complete':
              return completeGoal(goal, params.evidence, signal)
            case 'blocked':
              return blockGoal(goal, params.blocked_reason)
          }
        })()
    })

    // Tasks 5–9 fill these in; the skeleton keeps the model-facing contract compilable.
    const completeGoal = async (goal: GoalSnapshot, evidence: string | undefined, _signal: AbortSignal | undefined) => {
      void goal
      void evidence
      throw new GoalError('invalid_action', 'complete is not available yet')
    }
    const blockGoal = (goal: GoalSnapshot, reason: string | undefined) => {
      void goal
      void reason
      throw new GoalError('invalid_action', 'blocked is not available yet')
    }

    pi.registerCommand('goal', {
      description: 'Set or manage the session goal: [<objective> | edit <objective> | pause | resume | clear | rounds <n> | budget <tokens|$usd>]',
      handler: async (args, ctx) => {
        runtime.ctx = ctx
        const input = args.trim()
        try {
          if (input === '') {
            notice(runtime.goal ? `Goal: ${JSON.stringify(goalView(runtime.goal, runtime.armed))}` : 'No goal is set. Use /goal <objective> to create one.')
            return
          }
          if (CONTROL_WORDS.has(input)) {
            const goal = requireGoal()
            if (input === 'pause') {
              stop('paused_by_user')
              if (!ctx.isIdle()) ctx.abort()
              notice('Goal paused.')
            } else if (input === 'clear') {
              clear()
              if (!ctx.isIdle()) ctx.abort()
              notice('Goal cleared.')
            } else {
              commit(resumeGoal(goal, now()))
              runtime.armed = true
              notice('Goal resumed.')
              // Task 5 starts the first round from here when the agent is idle.
            }
            return
          }
          const [word, ...rest] = input.split(/\s+/)
          const value = rest.join(' ')
          if (word === 'edit') {
            commit(editGoal(requireGoal(), { objective: value }, port.defaults.maxGoalRoundsCeiling, now()))
            notice('Goal objective updated.')
            return
          }
          if (word === 'rounds') {
            commit(editGoal(requireGoal(), { maxGoalRounds: Number(value) }, port.defaults.maxGoalRoundsCeiling, now()))
            notice(`Round cap set to ${runtime.goal!.maxGoalRounds}.`)
            return
          }
          if (word === 'budget') {
            const budget = value.startsWith('$') ? { usd: Number(value.slice(1)) } : { tokens: Number(value) }
            commit(editGoal(requireGoal(), { budget }, port.defaults.maxGoalRoundsCeiling, now()))
            notice('Budget updated.')
            return
          }
          if (runtime.goal && runtime.goal.phase !== 'complete') throw new GoalError('goal_exists', 'A goal is already set; use /goal edit, /goal pause or /goal clear first.')
          commit(createGoal(input, limits(), {}, now()))
          runtime.armed = true
          notice('Goal created.')
          // Task 5 starts the first round from here when the agent is idle.
        } catch (error) {
          notice(error instanceof Error ? error.message : String(error), 'error')
        }
      }
    })
  }
}
```

在 `src/index.ts` 加：

```ts
export {
  createGoalExtension,
  GOAL_TOOL_NAMES,
  type GoalApprovalEvent,
  type GoalPort,
  type GoalVerifier
} from './goalExtension'
export {
  GOAL_NOTICE_TYPE,
  GOAL_ROUND_TYPE,
  GOAL_STATE_TYPE,
  type GoalBudget,
  type GoalPhase,
  type GoalSnapshot,
  type GoalStopCode
} from './goalState'
```

- [ ] **Step 5: 跑测试确认通过；typecheck**

Run: `pnpm exec vitest run --project agent-runtime packages/agent-runtime/tests/goal.test.ts && pnpm --filter @cherrystudio/agent-runtime typecheck`
Expected: PASS。若 `execute` 的第五个参数类型 `ExtensionToolContext` 不含 `sessionManager`，保持用 `runtime.ctx`（来自 `session_start`、`turn_start`、`tool_call` 事件）读 branch，不要改用它。

- [ ] **Step 6: 格式、lint、提交**

```bash
pnpm exec oxfmt --write packages/agent-runtime/src/goalExtension.ts packages/agent-runtime/src/index.ts packages/agent-runtime/tests/goal.test.ts packages/agent-runtime/tests/goalSupport.ts
pnpm exec oxlint --deny-warnings packages/agent-runtime/src packages/agent-runtime/tests
git add packages/agent-runtime/src/goalExtension.ts packages/agent-runtime/src/index.ts packages/agent-runtime/tests/goal.test.ts packages/agent-runtime/tests/goalSupport.ts
git commit -S --signoff -m "feat(agent-runtime): add goal tools and the /goal command"
```

---

### Task 5: 续跑、预约与接纳、首轮启动、让路、每轮确认

**Files:**
- Modify: `packages/agent-runtime/src/goalExtension.ts`
- Test: `packages/agent-runtime/tests/goal.test.ts`

**Interfaces:**
- Consumes：任务 4 的 `runtime`、`commit`、`stop`、`notice`。
- Produces：`turn_start` / `turn_end` / `agent_before_settle` / `agent_settled` 处理器；`startRound(ctx)` 供命令使用。任务 6–9 在 `decide()` 里加判断。

- [ ] **Step 1: 写失败的测试**

追加到 `tests/goal.test.ts`（把 `rounds` 加进顶部的 `./goalSupport` import）：

```ts
describe('goal continuation', () => {
  it('pushes the model again after it stops, stamping each round once it is admitted', async () => {
    const { session: s, host, calls } = await session(
      [
        () => say('Round one done.'),
        () => say('Round two done.'),
        (prompt) => [toolCall('g', 'get_goal', {}), finish('tool-calls')],
        (prompt) => [toolCall('p', 'update_goal', { goal_id: readGoal(prompt).goal!.id, revision: readGoal(prompt).goal!.revision, action: 'pause' }), finish('tool-calls')],
        () => say('Paused.')
      ],
      goalPort({ defaults: { maxGoalRounds: 3 } })
    )
    await s.prompt('/goal Keep working')

    expect(rounds(host.entries).map((r) => [r.round, r.kind])).toEqual([[1, 'work'], [2, 'work'], [3, 'wrap-up']])
    expect(calls.length).toBe(5)
    // round 3's pause came from a goal round, so it is refused: pause needs a human turn.
    const result = toolResults(s).find((r) => r.toolCallId === 'p')!
    expect(result.isError).toBe(true)
    expect(textOf(result)).toMatch(/human request/)
  })

  it('does not count a round that a later extension vetoed', async () => {
    const { model } = goalModel([() => say('one')])
    const host = hostStore()
    const { session: s } = await createTestSession({
      port: streamTextPort(model).port,
      extensionFactories: [
        createGoalExtension(goalPort()),
        (pi) => {
          pi.on('agent_before_settle', () => ({ continue: false }))
        }
      ],
      onEvent: host.onEvent
    })
    await s.prompt('/goal Keep working')

    expect(lastSnapshot(host.entries)).toMatchObject({ roundsStarted: 1, lastStop: { code: 'continuation_rejected' } })
  })

  it('yields to a user message that arrives mid-round and continues afterwards', async () => {
    let interrupted = false
    const { session: s, host, calls } = await session(
      [
        () => say('one'),
        () => say('two'),
        () => say('answer to the user'),
        () => say('three'),
        () => say('four, wrapping up')
      ],
      goalPort({ defaults: { maxGoalRounds: 4 } })
    )
    s.subscribe((event) => {
      if (event.type === 'turn_end' && !interrupted && rounds(host.entries).length === 2) {
        interrupted = true
        void s.prompt('a question from the user', { streamingBehavior: 'followUp' })
      }
    })
    await s.prompt('/goal Keep working')
    await new Promise((resolve) => setTimeout(resolve, 50))

    const kinds = host.entries.map((e) => (e.kind === 'message' ? (e.custom ? 'round' : e.message.role) : e.kind))
    const userIndex = kinds.indexOf('user')
    expect(userIndex).toBeGreaterThan(-1)
    expect(kinds.slice(userIndex)).toContain('round')
    expect(calls.some((c) => JSON.stringify(c.prompt).includes('a question from the user'))).toBe(true)
  })

  it('in confirm-each-round mode runs one round per resume', async () => {
    const port = goalPort({ defaults: { autonomy: () => 'confirm-each-round' } })
    const { session: s, host } = await session([() => say('one'), () => say('two'), () => say('three')], port)
    await s.prompt('/goal Keep working')
    expect(lastSnapshot(host.entries)).toMatchObject({ roundsStarted: 1, phase: 'paused', lastStop: { code: 'paused_each_round' } })

    await s.prompt('/goal resume')
    expect(lastSnapshot(host.entries)).toMatchObject({ roundsStarted: 2, phase: 'paused' })
  })

  it('a goal created by the model in a human turn continues in that same run', async () => {
    const { session: s, host } = await session(
      [() => [toolCall('c1', 'create_goal', { objective: 'g' }), finish('tool-calls')], () => say('first reply'), (_prompt, call) => say(`round ${call}`)],
      goalPort({ defaults: { maxGoalRounds: 2 } })
    )
    await s.prompt('please do g')
    expect(rounds(host.entries).map((r) => r.round)).toEqual([1, 2])
    expect(lastSnapshot(host.entries)).toMatchObject({ lastStop: { code: 'round_limit' } })
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run --project agent-runtime packages/agent-runtime/tests/goal.test.ts -t continuation`
Expected: FAIL，没有任何 round 条目。

- [ ] **Step 3: 实现续跑**

在 `createGoalExtension` 里、`registerCommand` 之前加：

```ts
    const roundMessage = (details: RoundDetails) => ({
      type: 'custom_message' as const,
      customType: GOAL_ROUND_TYPE,
      content: renderRoundPrompt(runtime.goal!, details, port.defaults.blockedAfter, runtime.noProgressRounds),
      display: false,
      details
    })

    const nextRoundKind = (goal: GoalSnapshot): RoundDetails['kind'] =>
      goal.roundsStarted + 1 >= goal.maxGoalRounds || budgetExceeded(goal)
        ? 'wrap-up'
        : runtime.noProgressRounds === 2
          ? 'hint'
          : 'work'

    const reserve = (): RoundDetails => {
      const goal = runtime.goal!
      const details: RoundDetails = { goalId: goal.id, revision: goal.revision, round: goal.roundsStarted + 1, kind: nextRoundKind(goal) }
      runtime.reservation = details
      return details
    }

    /** Spec §6.0: a command that arms the goal while the agent is idle starts the first round itself. */
    const startRound = (ctx: ExtensionContext) => {
      if (!runtime.goal || !runtime.armed || !ctx.isIdle()) return
      const details = reserve()
      const message = roundMessage(details)
      pi.sendMessage({ customType: message.customType, content: message.content, display: message.display, details: message.details }, { triggerTurn: true })
    }

    /** Spec §6.2, in order. Returns the boundary result for `agent_before_settle`. */
    const decide = (event: { outcome: 'completed' | 'aborted' | 'error'; context: { pendingMessages: unknown[] } }) => {
      if (event.outcome === 'aborted') {
        if (runtime.goal?.phase === 'active') stop('aborted')
        return undefined
      }
      if (event.outcome === 'error') {
        if (runtime.goal?.phase === 'active') stop('provider_error', lastErrorMessage())
        return undefined
      }
      if (!runtime.goal || runtime.goal.phase !== 'active') return undefined
      // Budget checks below read the usage of the round that just ended.
      runtime.goal = recordUsage(runtime.goal, runtime.pendingUsage, false)
      runtime.pendingUsage = { tokens: 0, usd: 0 }
      const goal = runtime.goal
      if (runtime.stopRequest) {
        const { code, message } = runtime.stopRequest
        runtime.stopRequest = undefined
        stop(code, message)
        return undefined
      }
      if (!runtime.armed) return undefined
      if (runtime.inGoalRound && port.defaults.autonomy() === 'confirm-each-round') {
        stop('paused_each_round')
        return undefined
      }
      if (event.context.pendingMessages.length > 0) return undefined
      if (port.hasRunningChildren?.() === true) {
        stop('waiting_children')
        return undefined
      }
      if (runtime.noProgressRounds >= 3) {
        stop('no_progress')
        return undefined
      }
      if (goal.wrapUpDone) {
        stop(goal.roundsStarted >= goal.maxGoalRounds ? 'round_limit' : 'budget_exhausted')
        return undefined
      }
      const details = reserve()
      return { entries: [roundMessage(details)], continue: true }
    }

    const lastErrorMessage = () => {
      const last = branch().at(-1)
      return last?.type === 'message' && last.message.role === 'assistant' ? last.message.errorMessage : undefined
    }

    pi.on('turn_start', (_event, ctx) => {
      runtime.ctx = ctx
      runtime.repeat = { key: undefined, count: 0 }
      const entries = ctx.sessionManager.getBranch()
      const round = tailRound(entries)
      const reservation = runtime.reservation
      if (round && reservation && runtime.goal && round.goalId === reservation.goalId && round.revision === reservation.revision && round.round === reservation.round) {
        runtime.reservation = undefined
        runtime.inGoalRound = true
        runtime.lastRoundProgressed = undefined
        commit(admitRound(runtime.goal, round.kind, now()))
        return
      }
      if (isHumanTurn(entries)) {
        runtime.inGoalRound = false
        runtime.noProgressRounds = 0
        runtime.blockedRounds = { revision: 0, rounds: new Set() }
      }
    })

    pi.on('turn_end', (event) => {
      if (!runtime.goal || !runtime.inGoalRound || event.message.role !== 'assistant') return
      const usage = event.message.usage
      runtime.pendingUsage.tokens += usage.input + usage.output + usage.cacheRead + usage.cacheWrite
      runtime.pendingUsage.usd += usage.cost.total
      const progressed = turnProgress(event.message, event.toolResults, runtime.previousText)
      runtime.previousText = assistantText(event.message)
      if (progressed) runtime.lastRoundProgressed = true
      else if (runtime.lastRoundProgressed === undefined) runtime.lastRoundProgressed = false
    })

    pi.on('agent_before_settle', (event, ctx) => {
      runtime.ctx = ctx
      // A round counts once, at its end: it progressed if any of its turns did.
      if (runtime.inGoalRound && runtime.goal) {
        if (runtime.lastRoundProgressed) {
          runtime.noProgressRounds = 0
          runtime.goal = recordUsage(runtime.goal, { tokens: 0, usd: 0 }, true)
        } else {
          runtime.noProgressRounds += 1
        }
      }
      runtime.lastRoundProgressed = undefined
      return decide(event)
    })

    pi.on('agent_settled', () => {
      if (!runtime.reservation) return
      runtime.reservation = undefined
      if (runtime.goal && runtime.goal.phase === 'active') stop('continuation_rejected')
    })
```

命令里两处 `// Task 5 starts the first round` 换成 `startRound(ctx)`。`decide` 用到的 `budgetExceeded` 从 `./goalState` 导入。

`decide()` 的判断顺序就是 spec §6.2 的顺序；无进展（第 9 条）排在预算（第 10 条）之前，所以测试里凡是想验证 `round_limit` / `budget_exhausted` 的场景，每轮的回复文本必须不同，否则会先以 `no_progress` 停下。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run --project agent-runtime packages/agent-runtime/tests/goal.test.ts`
Expected: PASS。"a goal created by the model" 用例的 `complete` 仍会以错误结果结束（任务 9 才实现），用例只断言有轮次。

- [ ] **Step 5: 格式、lint、提交**

```bash
pnpm exec oxfmt --write packages/agent-runtime/src/goalExtension.ts packages/agent-runtime/tests/goal.test.ts
pnpm exec oxlint --deny-warnings packages/agent-runtime/src packages/agent-runtime/tests
git add packages/agent-runtime/src/goalExtension.ts packages/agent-runtime/tests/goal.test.ts
git commit -S --signoff -m "feat(agent-runtime): continue goals at the settle boundary and count admitted rounds"
```

---

### Task 6: 轮数上限与预算

**Files:**
- Modify: `packages/agent-runtime/src/goalExtension.ts`（无新逻辑；本任务验证任务 5 的 `nextRoundKind` / `decide` 与任务 2 的迁移）
- Create: `packages/agent-runtime/tests/goalStops.test.ts`

**Interfaces:**
- Consumes：`createGoalExtension`、`goalSupport.ts` 的助手；`MODEL.cost = { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 0 }`（`tests/support.ts`，单价按每百万 token），`finish(unified, input = 10, output = 5)` 给每次回复 `input+2` 个输入 token（其中 2 个 cacheRead）和 `output` 个输出 token。

- [ ] **Step 1: 写失败的测试**

```ts
// packages/agent-runtime/tests/goalStops.test.ts
import { describe, expect, it } from 'vitest'

import { createGoalExtension } from '../src'
import { goalModel, goalPort, lastSnapshot, readGoal, rounds, say, toolCall } from './goalSupport'
import { createTestSession, finish, hostStore, streamTextPort } from './support'
import { textOf, toolResults } from './toolResults'

async function session(scripts: Parameters<typeof goalModel>[0], port = goalPort()) {
  const { model, calls } = goalModel(scripts)
  const host = hostStore()
  const runtime = await createTestSession({
    port: streamTextPort(model).port,
    extensionFactories: [createGoalExtension(port)],
    onEvent: host.onEvent
  })
  return { ...runtime, calls, host }
}

describe('goal caps and budgets', () => {
  // Replies differ per call so the rounds count as progress; identical replies would stop the goal
  // with no_progress first (spec §6.2 checks it before the budget).
  const working = (_prompt: unknown, call: number) => say(`working on step ${call}`)

  it('runs the last allowed round as a wrap-up, then blocks with round_limit', async () => {
    const { session: s, host, calls } = await session([working], goalPort({ defaults: { maxGoalRounds: 3 } }))
    await s.prompt('/goal Keep working')

    expect(rounds(host.entries).map((r) => [r.round, r.kind])).toEqual([[1, 'work'], [2, 'work'], [3, 'wrap-up']])
    expect(JSON.stringify(calls.at(-1)!.prompt)).toContain('Do not start new work')
    expect(lastSnapshot(host.entries)).toMatchObject({ phase: 'blocked', roundsStarted: 3, wrapUpDone: true, lastStop: { code: 'round_limit' } })
  })

  it('after round_limit, resume is refused until the cap is raised, then one more round runs', async () => {
    const { session: s, host } = await session([working], goalPort({ defaults: { maxGoalRounds: 1 } }))
    await s.prompt('/goal Keep working')
    expect(lastSnapshot(host.entries)).toMatchObject({ lastStop: { code: 'round_limit' } })

    await s.prompt('/goal resume')
    expect(lastSnapshot(host.entries)).toMatchObject({ roundsStarted: 1, phase: 'blocked' })

    await s.prompt('/goal rounds 2')
    await s.prompt('/goal resume')
    expect(lastSnapshot(host.entries)).toMatchObject({ roundsStarted: 2, lastStop: { code: 'round_limit' } })
  })

  it('a token budget ends the goal after one wrap-up round once crossed', async () => {
    // each reply: 12 input (10 + 2 cache) + 5 output = 17 tokens
    const { session: s, host } = await session([working], goalPort({ defaults: { budget: { tokens: 20 } } }))
    await s.prompt('/goal Keep working')

    const kinds = rounds(host.entries).map((r) => r.kind)
    expect(kinds).toEqual(['work', 'work', 'wrap-up'])
    expect(lastSnapshot(host.entries)).toMatchObject({ phase: 'blocked', lastStop: { code: 'budget_exhausted' } })
    expect(lastSnapshot(host.entries)!.tokensUsed).toBeGreaterThanOrEqual(20)
  })

  it('a usd budget uses the price Pi computed from the model spec', async () => {
    // MODEL prices input at $1 and output at $2 per million tokens: ~2e-5 per reply
    const { session: s, host } = await session([working], goalPort({ defaults: { budget: { usd: 0.00003 } } }))
    await s.prompt('/goal Keep working')

    expect(rounds(host.entries).map((r) => r.kind)).toEqual(['work', 'work', 'wrap-up'])
    expect(lastSnapshot(host.entries)!.costUsed).toBeGreaterThan(0)
  })

  it('the model can set a smaller cap than the default and not one above the ceiling', async () => {
    const { session: s } = await session([
      () => [toolCall('c1', 'create_goal', { objective: 'g', max_goal_rounds: 5000 }), finish('tool-calls')],
      () => say('ok')
    ], goalPort({ defaults: { maxGoalRoundsCeiling: 1000 } }))
    await s.prompt('go')
    const [result] = toolResults(s)
    expect(result.isError).toBe(true)
    expect(textOf(result)).toMatch(/between 1 and 1000/)
  })
})
```

- [ ] **Step 2: 跑测试**

Run: `pnpm exec vitest run --project agent-runtime packages/agent-runtime/tests/goalStops.test.ts`
Expected: PASS。这些用例守的是任务 2 的迁移和任务 5 的 `decide` / `nextRoundKind`，所以此时应当已经通过；它们的价值在于以后改动这两处时会失败。

- [ ] **Step 3: 若有失败，只修 `decide()` / `nextRoundKind`**

常见原因：`decide()` 没有在预算判断前把 `pendingUsage` 折进 `runtime.goal`（任务 5 的代码里有这两行）；`nextRoundKind` 把 hint 排在 wrap-up 之前。不要为了让测试通过去改测试里的轮数或预算。

- [ ] **Step 4: 跑测试确认全部通过**

Run: `pnpm exec vitest run --project agent-runtime packages/agent-runtime/tests/goalStops.test.ts`
Expected: PASS

- [ ] **Step 5: 格式、lint、提交**

```bash
pnpm exec oxfmt --write packages/agent-runtime/src/goalExtension.ts packages/agent-runtime/tests/goalStops.test.ts
pnpm exec oxlint --deny-warnings packages/agent-runtime/src packages/agent-runtime/tests
git add packages/agent-runtime/src/goalExtension.ts packages/agent-runtime/tests/goalStops.test.ts
git commit -S --signoff -m "test(agent-runtime): cover goal round caps and budgets"
```

---

### Task 7: 无进展检测

**Files:**
- Modify: `packages/agent-runtime/src/goalExtension.ts`
- Test: `packages/agent-runtime/tests/goalStops.test.ts`

**Interfaces:**
- Consumes：`toolCallKey`、`runtime.repeat`、`runtime.stopRequest`、`runtime.noProgressRounds`。
- Produces：`tool_call` 处理器。

- [ ] **Step 1: 写失败的测试**

追加到 `goalStops.test.ts`：

```ts
import { Type } from '@earendil-works/pi-ai'
import { defineTool } from '@earendil-works/pi-coding-agent'

const echo = defineTool({
  name: 'echo',
  label: 'Echo',
  description: 'Returns its input',
  parameters: Type.Object({ value: Type.String() }),
  async execute(_id, params) {
    return { content: [{ type: 'text', text: params.value }], details: undefined }
  }
})
const readFile = defineTool({
  name: 'read',
  label: 'Read',
  description: 'Reads a file',
  parameters: Type.Object({ path: Type.String() }),
  async execute(_id, params) {
    return { content: [{ type: 'text', text: `contents of ${params.path}` }], details: undefined }
  }
})

describe('goal no-progress detection', () => {
  it('hints on the third round and stops on the fourth when every round only reads', async () => {
    const { model, calls } = goalModel([
      () => [toolCall('r', 'read', { path: 'a.md' }), finish('tool-calls')],
      () => say('I read the file.')
    ])
    const host = hostStore()
    const { session: s } = await createTestSession({
      port: streamTextPort(model).port,
      tools: [readFile],
      extensionFactories: [createGoalExtension(goalPort())],
      onEvent: host.onEvent
    })
    await s.prompt('/goal Keep working')

    const kinds = rounds(host.entries).map((r) => r.kind)
    expect(kinds).toEqual(['work', 'work', 'hint'])
    expect(JSON.stringify(calls.at(-2)!.prompt)).toContain('made no observable progress')
    expect(lastSnapshot(host.entries)).toMatchObject({ phase: 'blocked', lastStop: { code: 'no_progress' }, progressRounds: 0 })
  })

  it('a round with a successful non-read call resets the count', async () => {
    let round = 0
    const { model } = goalModel([
      () => {
        round += 1
        return round % 3 === 0 ? [toolCall(`e${round}`, 'echo', { value: 'x' }), finish('tool-calls')] : say('nothing new')
      },
      () => say('nothing new')
    ])
    // Goal rounds alternate: text / text / echo / text / text / echo ... with a 7-round cap.
    const host = hostStore()
    const { session: s } = await createTestSession({
      port: streamTextPort(model).port,
      tools: [echo],
      extensionFactories: [createGoalExtension(goalPort({ defaults: { maxGoalRounds: 7 } }))],
      onEvent: host.onEvent
    })
    await s.prompt('/goal Keep working')

    expect(lastSnapshot(host.entries)).toMatchObject({ lastStop: { code: 'round_limit' } })
    expect(lastSnapshot(host.entries)!.progressRounds).toBeGreaterThanOrEqual(2)
  })

  it('blocks the third identical tool call with a hint and ends the goal after the fifth', async () => {
    const { model } = goalModel([() => [toolCall(`r${Math.random()}`, 'read', { path: 'same.md' }), finish('tool-calls')]])
    const host = hostStore()
    const { session: s } = await createTestSession({
      port: streamTextPort(model).port,
      tools: [readFile],
      extensionFactories: [createGoalExtension(goalPort())],
      onEvent: host.onEvent
    })
    await s.prompt('/goal Keep working')

    const results = toolResults(s).filter((r) => r.toolName === 'read')
    expect(results.filter((r) => r.isError).length).toBeGreaterThanOrEqual(3)
    expect(textOf(results.find((r) => r.isError)!)).toMatch(/already been executed/)
    expect(lastSnapshot(host.entries)).toMatchObject({ lastStop: { code: 'no_progress' }, roundsStarted: 1 })
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run --project agent-runtime packages/agent-runtime/tests/goalStops.test.ts -t "no-progress"`
Expected: 第一、三个 FAIL（没有 hint、没有轮内拦截）。

- [ ] **Step 3: 实现轮内重复检测**

在 `pi.on('turn_start', …)` 之后加：

```ts
    pi.on('tool_call', (event, ctx) => {
      runtime.ctx = ctx
      if (!runtime.goal || !runtime.inGoalRound || event.parentToolCallId !== undefined) return undefined
      const key = toolCallKey(event.toolName, event.input)
      runtime.repeat = runtime.repeat.key === key ? { key, count: runtime.repeat.count + 1 } : { key, count: 1 }
      if (runtime.repeat.count < 3) return undefined
      if (runtime.repeat.count >= 5) runtime.stopRequest = { code: 'no_progress', message: `the same ${event.toolName} call was repeated ${runtime.repeat.count} times` }
      return {
        block: true,
        reason: 'The same call has already been executed in this round and its result will not change; change approach or report the concrete blocker.',
        terminate: runtime.repeat.count >= 5
      }
    })
```

第一个用例失败的原因是 `decide()` 在无进展计数达到 3 时直接停，而 hint 轮应该在计数为 2 时发出：检查任务 5 的 `nextRoundKind`（`runtime.noProgressRounds === 2` → `'hint'`）和 `agent_before_settle` 里递增计数的位置——递增必须发生在 `decide()` 之前。顺序：第 1 轮无进展 → 计数 1 → 第 2 轮 work；第 2 轮无进展 → 计数 2 → 第 3 轮 hint；第 3 轮无进展 → 计数 3 → 停。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run --project agent-runtime packages/agent-runtime/tests/goalStops.test.ts`
Expected: PASS

- [ ] **Step 5: 格式、lint、提交**

```bash
pnpm exec oxfmt --write packages/agent-runtime/src/goalExtension.ts packages/agent-runtime/tests/goalStops.test.ts
pnpm exec oxlint --deny-warnings packages/agent-runtime/src packages/agent-runtime/tests
git add packages/agent-runtime/src/goalExtension.ts packages/agent-runtime/tests/goalStops.test.ts
git commit -S --signoff -m "feat(agent-runtime): stop goals that make no progress"
```

---

### Task 8: 需要人、错误、中止、命令抢占

**Files:**
- Modify: `packages/agent-runtime/src/goalExtension.ts`
- Test: `packages/agent-runtime/tests/goalStops.test.ts`

**Interfaces:**
- Consumes：`port.onApproval`、L3 的 `createAskUserExtension` 与 `AskUserQuestionDetails.outcome`（任务 1）、`runtime.stopRequest`。
- Produces：审批监听、`AskUserQuestion` 结果检查（在 `turn_end`）、`session_shutdown` 清理。

- [ ] **Step 1: 写失败的测试**

```ts
import { createAskUserExtension, type GoalApprovalEvent } from '../src'

describe('goal stops for people, errors and aborts', () => {
  it('a denied approval in a goal round blocks the goal with approval_denied after that round', async () => {
    let emit: ((event: GoalApprovalEvent) => void) | undefined
    const port = goalPort({
      onApproval: (listener) => {
        emit = listener
        return () => (emit = undefined)
      }
    })
    const deny = defineTool({
      name: 'risky',
      label: 'Risky',
      description: 'Pretends the host denied it',
      parameters: Type.Object({}),
      async execute(id) {
        emit?.({ kind: 'denied', toolCallId: id })
        return { content: [{ type: 'text', text: 'denied by user' }], details: undefined, isError: true }
      }
    })
    const { model } = goalModel([() => [toolCall('k', 'risky', {}), finish('tool-calls')], () => say('I will try something else.')])
    const host = hostStore()
    const { session: s } = await createTestSession({
      port: streamTextPort(model).port,
      tools: [deny],
      extensionFactories: [createGoalExtension(port)],
      onEvent: host.onEvent
    })
    await s.prompt('/goal Keep working')

    expect(lastSnapshot(host.entries)).toMatchObject({ phase: 'blocked', roundsStarted: 1, lastStop: { code: 'approval_denied' } })
  })

  it('an unattended approval request pauses with awaiting_approval', async () => {
    let emit: ((event: GoalApprovalEvent) => void) | undefined
    const port = goalPort({ onApproval: (listener) => ((emit = listener), () => {}) })
    const tool = defineTool({
      name: 'risky',
      label: 'Risky',
      description: 'x',
      parameters: Type.Object({}),
      async execute(id) {
        emit?.({ kind: 'unavailable', toolCallId: id })
        return { content: [{ type: 'text', text: 'nobody can approve' }], details: undefined, isError: true }
      }
    })
    const { model } = goalModel([() => [toolCall('k', 'risky', {}), finish('tool-calls')], () => say('ok')])
    const host = hostStore()
    const { session: s } = await createTestSession({ port: streamTextPort(model).port, tools: [tool], extensionFactories: [createGoalExtension(port)], onEvent: host.onEvent })
    await s.prompt('/goal Keep working')
    expect(lastSnapshot(host.entries)).toMatchObject({ lastStop: { code: 'awaiting_approval' } })
  })

  it('a question the user dismisses in a goal round blocks the goal with needs_user_input', async () => {
    const { model } = goalModel([
      () => [toolCall('q', 'AskUserQuestion', { questions: [{ question: 'Which?', header: 'Pick', options: [{ label: 'A', description: 'a' }, { label: 'B', description: 'b' }] }] }), finish('tool-calls')],
      () => say('ok')
    ])
    const host = hostStore()
    const { session: s } = await createTestSession({
      port: streamTextPort(model).port,
      extensionFactories: [createAskUserExtension({ ask: async () => ({ status: 'declined' }) }), createGoalExtension(goalPort())],
      onEvent: host.onEvent
    })
    await s.prompt('/goal Keep working')
    expect(lastSnapshot(host.entries)).toMatchObject({ lastStop: { code: 'needs_user_input' } })
  })

  it('a question nobody can answer does not stop the goal', async () => {
    const { model } = goalModel([
      () => [toolCall('q', 'AskUserQuestion', { questions: [{ question: 'Which?', header: 'Pick', options: [{ label: 'A', description: 'a' }, { label: 'B', description: 'b' }] }] }), finish('tool-calls')],
      () => say('Proceeding with A.'),
      () => say('more')
    ])
    const host = hostStore()
    const { session: s } = await createTestSession({
      port: streamTextPort(model).port,
      extensionFactories: [createAskUserExtension({ ask: async () => ({ status: 'unavailable' }) }), createGoalExtension(goalPort({ defaults: { maxGoalRounds: 3 } }))],
      onEvent: host.onEvent
    })
    await s.prompt('/goal Keep working')
    expect(lastSnapshot(host.entries)).toMatchObject({ lastStop: { code: 'round_limit' } })
  })

  it('a failed model request blocks the goal with provider_error and the provider message', async () => {
    const { model } = goalModel([
      () => say('one'),
      () => [{ type: 'error', error: new Error('upstream exploded') }]
    ])
    const host = hostStore()
    const { session: s } = await createTestSession({ port: streamTextPort(model).port, extensionFactories: [createGoalExtension(goalPort())], onEvent: host.onEvent })
    await s.prompt('/goal Keep working').catch(() => {})
    expect(lastSnapshot(host.entries)).toMatchObject({ phase: 'blocked', lastStop: { code: 'provider_error', message: 'upstream exploded' } })
  })

  it('aborting the run pauses the goal and nothing continues', async () => {
    const chunks = Array.from({ length: 40 }, (_, i) => `w${i} `)
    const { model, calls } = goalModel([
      () => [{ type: 'text-start', id: 't' }, ...chunks.map((delta) => ({ type: 'text-delta' as const, id: 't', delta })), { type: 'text-end', id: 't' }, finish('stop')]
    ])
    const host = hostStore()
    const { session: s } = await createTestSession({ port: streamTextPort(model).port, extensionFactories: [createGoalExtension(goalPort())], onEvent: host.onEvent })
    s.subscribe((event) => {
      if (event.type === 'message_update' && event.assistantMessageEvent.type === 'text_delta' && rounds(host.entries).length === 2) void s.abort()
    })
    await s.prompt('/goal Keep working')
    expect(lastSnapshot(host.entries)).toMatchObject({ phase: 'paused', lastStop: { code: 'aborted' } })
    expect(calls.length).toBe(2)
  })

  it('/goal pause typed during a round aborts that round and nothing continues', async () => {
    const { model, calls } = goalModel([() => say('x '.repeat(200))])
    const host = hostStore()
    const { session: s } = await createTestSession({ port: streamTextPort(model).port, extensionFactories: [createGoalExtension(goalPort())], onEvent: host.onEvent })
    let sent = false
    s.subscribe((event) => {
      if (event.type === 'message_update' && !sent && rounds(host.entries).length === 1) {
        sent = true
        void s.prompt('/goal pause')
      }
    })
    await s.prompt('/goal Keep working')
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(lastSnapshot(host.entries)).toMatchObject({ phase: 'paused', lastStop: { code: 'paused_by_user' } })
    expect(calls.length).toBe(1)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run --project agent-runtime packages/agent-runtime/tests/goalStops.test.ts -t "people, errors"`
Expected: 审批和提问的用例 FAIL；错误、中止、pause 的用例可能已通过（任务 5 的 `decide` 处理了 outcome）。

- [ ] **Step 3: 实现**

在 `session_start` 处理器里订阅审批，在 `session_shutdown` 里退订：

```ts
    let unsubscribeApproval: (() => void) | undefined
    pi.on('session_start', (_event, ctx) => {
      runtime.ctx = ctx
      runtime.goal = currentGoal(ctx.sessionManager.getBranch())
      runtime.armed = false
      runtime.inGoalRound = false
      unsubscribeApproval?.()
      unsubscribeApproval = port.onApproval?.((event) => {
        if (!runtime.goal || !runtime.inGoalRound) return
        if (event.kind === 'denied') runtime.stopRequest = { code: 'approval_denied', message: `tool call ${event.toolCallId} was denied` }
        if (event.kind === 'unavailable') runtime.stopRequest = { code: 'awaiting_approval', message: `tool call ${event.toolCallId} needs approval and nobody can give it` }
      })
    })
    pi.on('session_shutdown', () => {
      unsubscribeApproval?.()
      unsubscribeApproval = undefined
    })
```

在 `turn_end` 里加提问检查（`progressed` 之前）：

```ts
      for (const result of event.toolResults) {
        if (result.toolName !== 'AskUserQuestion') continue
        const outcome = (result.details as { outcome?: string } | undefined)?.outcome
        if (outcome === 'declined') runtime.stopRequest = { code: 'needs_user_input', message: 'the user dismissed the question' }
      }
```

`decide()` 已经把 `stopRequest` 排在第 4 位；审批被拒不触碰 `blockedRounds`。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run --project agent-runtime packages/agent-runtime/tests/goalStops.test.ts`
Expected: PASS

- [ ] **Step 5: 格式、lint、提交**

```bash
pnpm exec oxfmt --write packages/agent-runtime/src/goalExtension.ts packages/agent-runtime/tests/goalStops.test.ts
pnpm exec oxlint --deny-warnings packages/agent-runtime/src packages/agent-runtime/tests
git add packages/agent-runtime/src/goalExtension.ts packages/agent-runtime/tests/goalStops.test.ts
git commit -S --signoff -m "feat(agent-runtime): stop goals when a person is needed, on errors and on abort"
```

---

### Task 9: 模型自报：complete 与 blocked

**Files:**
- Modify: `packages/agent-runtime/src/goalExtension.ts`
- Test: `packages/agent-runtime/tests/goalStops.test.ts`

**Interfaces:**
- Consumes：`port.verify`、`port.defaults.blockedAfter`、`runtime.blockedRounds`、`toModelMessages` / `convertToLlm`。
- Produces：`completeGoal`、`blockGoal` 的真实实现（替换任务 4 的占位）。

- [ ] **Step 1: 写失败的测试**

```ts
describe('goal self-reports', () => {
  // Tool call ids are unique per call: Pi pairs results by id across the whole transcript.
  const completeCall = (prompt: Parameters<typeof readGoal>[0], evidence?: string) => {
    const { goal } = readGoal(prompt)
    return [toolCall(`done-${goal!.revision}`, 'update_goal', { goal_id: goal!.id, revision: goal!.revision, action: 'complete', ...(evidence === undefined ? {} : { evidence }) }), finish('tool-calls')]
  }
  const blockedCall = (prompt: Parameters<typeof readGoal>[0]) => {
    const { goal } = readGoal(prompt)
    return [toolCall(`blocked-${goal!.roundsStarted}`, 'update_goal', { goal_id: goal!.id, revision: goal!.revision, action: 'blocked', blocked_reason: 'the API key is missing' }), finish('tool-calls')]
  }
  const completions = (s: Parameters<typeof toolResults>[0]) => toolResults(s).filter((r) => r.toolCallId.startsWith('done-'))

  it('without a verifier, complete needs a progressing round and evidence', async () => {
    const { session: s, host } = await session([
      () => [toolCall('g', 'get_goal', {}), finish('tool-calls')],
      (prompt) => completeCall(prompt),
      () => say('no progress yet')
    ], goalPort({ defaults: { maxGoalRounds: 2 } }))
    await s.prompt('/goal Keep working')
    const [attempt] = completions(s)
    expect(attempt.isError).toBe(true)
    expect(textOf(attempt)).toMatch(/evidence/)
    expect(lastSnapshot(host.entries)!.phase).not.toBe('complete')
  })

  it('without a verifier, complete with evidence after progress ends the goal and the run', async () => {
    const { model } = goalModel([
      () => [toolCall('e', 'echo', { value: 'did work' }), finish('tool-calls')],
      () => say('round one did work'),
      () => [toolCall('g', 'get_goal', {}), finish('tool-calls')],
      (prompt) => completeCall(prompt, 'echo returned did work'),
      () => say('All done.'),
      () => say('should not run')
    ])
    const host = hostStore()
    const { session: s } = await createTestSession({ port: streamTextPort(model).port, tools: [echo], extensionFactories: [createGoalExtension(goalPort())], onEvent: host.onEvent })
    await s.prompt('/goal Keep working')
    expect(lastSnapshot(host.entries)).toMatchObject({ phase: 'complete', lastStop: { code: 'complete' } })
    expect(rounds(host.entries).length).toBe(2)
  })

  it('a verifier that says not_met keeps the goal open with its reason; impossible blocks it', async () => {
    const verdicts: Array<'not_met' | 'impossible'> = ['not_met', 'impossible']
    const port = goalPort({
      verify: {
        verify: async ({ messages }) => {
          expect(messages.length).toBeGreaterThan(0)
          return { verdict: verdicts.shift()!, reason: 'tests are red' }
        }
      }
    })
    const { session: s, host } = await session([
      () => [toolCall('g', 'get_goal', {}), finish('tool-calls')],
      (prompt) => completeCall(prompt, 'x'),
      () => [toolCall('g2', 'get_goal', {}), finish('tool-calls')],
      (prompt) => completeCall(prompt, 'y'),
      () => say('ok')
    ], port)
    await s.prompt('/goal Keep working')
    const [first] = completions(s)
    expect(first.isError).toBe(true)
    expect(textOf(first)).toContain('tests are red')
    expect(lastSnapshot(host.entries)).toMatchObject({ phase: 'blocked', lastStop: { code: 'model_blocked', message: 'tests are red' } })
  })

  it('a verifier that throws does not pass the completion', async () => {
    const port = goalPort({ verify: { verify: async () => { throw new Error('evaluator offline') } } })
    const { session: s, host } = await session([
      () => [toolCall('g', 'get_goal', {}), finish('tool-calls')],
      (prompt) => completeCall(prompt, 'x'),
      () => say('ok')
    ], goalPort({ ...port, defaults: { maxGoalRounds: 2 } }))
    await s.prompt('/goal Keep working')
    expect(lastSnapshot(host.entries)!.phase).not.toBe('complete')
    expect(textOf(completions(s)[0])).toContain('evaluator offline')
  })

  it('blocked is refused until the same condition was reported in three consecutive rounds', async () => {
    // Every round: read the goal, report blocked, then stop. Calls 1-3 are round 1, 4-6 round 2, 7-9 round 3.
    const { session: s, host } = await session(
      [
        (prompt, call) =>
          call % 3 === 1
            ? [toolCall(`g${call}`, 'get_goal', {}), finish('tool-calls')]
            : call % 3 === 2
              ? blockedCall(prompt)
              : say('still blocked')
      ],
      goalPort({ defaults: { maxGoalRounds: 10 } })
    )
    await s.prompt('/goal Keep working')

    const attempts = toolResults(s).filter((r) => r.toolCallId.startsWith('blocked-'))
    expect(attempts.map((r) => r.isError)).toEqual([true, true, undefined])
    expect(textOf(attempts[0])).toMatch(/round 3/)
    expect(lastSnapshot(host.entries)).toMatchObject({ phase: 'blocked', roundsStarted: 3, lastStop: { code: 'model_blocked', message: 'the API key is missing' } })
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run --project agent-runtime packages/agent-runtime/tests/goalStops.test.ts -t "self-reports"`
Expected: FAIL，`complete is not available yet`。

- [ ] **Step 3: 实现**

替换任务 4 的占位：

```ts
    const recentMessages = (ctx: ExtensionContext): ConversationModelMessage[] => {
      const messages = convertToLlm(ctx.sessionManager.buildSessionContext().messages)
      return ctx.model ? toModelMessages(messages.slice(-VERIFY_MESSAGES), ctx.model) : []
    }

    const completeGoal = async (goal: GoalSnapshot, evidence: string | undefined, signal: AbortSignal | undefined) => {
      const claim = { evidence: hasText(evidence) ? evidence.trim() : undefined }
      if (port.verify && runtime.ctx) {
        let verdict: Awaited<ReturnType<GoalVerifier['verify']>>
        try {
          verdict = await port.verify.verify({ objective: goal.objective, claim, messages: recentMessages(runtime.ctx), signal: signal ?? new AbortController().signal })
        } catch (error) {
          throw new GoalError('invalid_action', `Completion could not be verified (${error instanceof Error ? error.message : String(error)}); keep working or report a blocker.`)
        }
        if (verdict.verdict === 'not_met') throw new GoalError('invalid_action', `Not complete yet: ${verdict.reason}`)
        if (verdict.verdict === 'impossible') {
          stop('model_blocked', verdict.reason)
          return ok()
        }
      } else {
        if (!claim.evidence) throw new GoalError('invalid_action', 'complete needs evidence: name each deliverable and what proves it is done.')
        if (goal.progressRounds === 0 && runtime.lastRoundProgressed !== true)
          throw new GoalError('invalid_action', 'No round of this goal changed anything yet; do the work before marking it complete.')
      }
      stop('complete')
      return ok()
    }

    const blockGoal = (goal: GoalSnapshot, reason: string | undefined) => {
      if (!hasText(reason)) throw new GoalError('invalid_action', 'blocked needs blocked_reason: the concrete condition that persisted.')
      if (isHumanTurn(branch())) {
        stop('model_blocked', reason.trim())
        return ok()
      }
      if (runtime.blockedRounds.revision !== goal.revision) runtime.blockedRounds = { revision: goal.revision, rounds: new Set() }
      runtime.blockedRounds.rounds.add(goal.roundsStarted)
      const needed = port.defaults.blockedAfter
      if (runtime.blockedRounds.rounds.size < needed) {
        const next = needed - runtime.blockedRounds.rounds.size
        throw new GoalError('invalid_action', `Keep trying; if the same condition still blocks you in round ${goal.roundsStarted + next}, report it again (${runtime.blockedRounds.rounds.size}/${needed}).`)
      }
      stop('model_blocked', reason.trim())
      return ok()
    }
```

`stop()` 在 goal 轮里把 `armed` 置 false，`decide()` 第 3 条看到 phase 不是 `active` 就不再续跑，所以 complete / blocked 后本轮结束即停，无需额外处理。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run --project agent-runtime packages/agent-runtime/tests/goalStops.test.ts`
Expected: PASS。若 "blocked is refused" 里 `attempts[0]` 文本的轮号不是 3，检查 `blockedRounds.rounds` 是否按 `goal.roundsStarted` 去重（同一轮内重复调用不加计数）。

- [ ] **Step 5: 格式、lint、提交**

```bash
pnpm exec oxfmt --write packages/agent-runtime/src/goalExtension.ts packages/agent-runtime/tests/goalStops.test.ts
pnpm exec oxlint --deny-warnings packages/agent-runtime/src packages/agent-runtime/tests
git add packages/agent-runtime/src/goalExtension.ts packages/agent-runtime/tests/goalStops.test.ts
git commit -S --signoff -m "feat(agent-runtime): accept goal completion and blocking on the runtime's terms"
```

---

### Task 10: 门控、重建、压缩

**Files:**
- Modify: `packages/agent-runtime/src/goalExtension.ts`
- Create: `packages/agent-runtime/tests/goalRebuild.test.ts`

**Interfaces:**
- Consumes：L2 的 `transcript` 选项与 `hostStore`；`port.modelSupportsTools`。
- Produces：`unsupported_model` 快照。

- [ ] **Step 1: 写失败的测试**

```ts
// packages/agent-runtime/tests/goalRebuild.test.ts
import type { LanguageModelV3StreamPart } from '@ai-sdk/provider'
import { describe, expect, it } from 'vitest'

import { createGoalExtension } from '../src'
import { goalModel, goalPort, lastSnapshot, rounds, say } from './goalSupport'
import { createTestSession, hostStore, MODEL, plain, streamTextPort, tempDir } from './support'

describe('goal across sessions', () => {
  it('a rebuilt session restores the goal disarmed and resume continues it', async () => {
    const first = goalModel([() => say('one')])
    const host = hostStore()
    const cwd = tempDir('cwd')
    // The cap is stored on the goal at creation, so the rebuilt session inherits 3.
    const live = await createTestSession({
      cwd,
      port: streamTextPort(first.model).port,
      extensionFactories: [createGoalExtension(goalPort({ defaults: { autonomy: () => 'confirm-each-round', maxGoalRounds: 3 } }))],
      onEvent: host.onEvent
    })
    await live.session.prompt('/goal Keep working')
    expect(lastSnapshot(host.entries)).toMatchObject({ roundsStarted: 1 })

    const second = goalModel([() => say('two'), (_prompt, call) => say(`three ${call}`)])
    const rebuiltHost = hostStore()
    const rebuilt = await createTestSession({
      cwd,
      port: streamTextPort(second.model).port,
      extensionFactories: [createGoalExtension(goalPort())],
      transcript: plain(host.entries),
      onEvent: rebuiltHost.onEvent
    })
    await rebuilt.session.prompt('hello again')
    expect(second.calls).toHaveLength(1)
    expect(rounds(rebuiltHost.entries)).toEqual([])

    await rebuilt.session.prompt('/goal resume')
    expect(rounds(rebuiltHost.entries).map((r) => r.round)[0]).toBe(2)
    // Replies differ, so the goal runs to its cap rather than stopping on no_progress.
    expect(lastSnapshot(rebuiltHost.entries)).toMatchObject({ roundsStarted: 3, lastStop: { code: 'round_limit' } })
  })

  it('a model without tool calling gets no goal tools and an active goal is marked unsupported', async () => {
    const first = goalModel([() => say('one')])
    const host = hostStore()
    const cwd = tempDir('cwd')
    const live = await createTestSession({
      cwd,
      port: streamTextPort(first.model).port,
      extensionFactories: [createGoalExtension(goalPort({ defaults: { autonomy: () => 'confirm-each-round' } }))],
      onEvent: host.onEvent
    })
    await live.session.prompt('/goal Keep working')

    const second = goalModel([() => say('plain text')])
    const rebuiltHost = hostStore()
    const rebuilt = await createTestSession({
      cwd,
      port: streamTextPort(second.model).port,
      extensionFactories: [createGoalExtension(goalPort({ modelSupportsTools: () => false }))],
      transcript: plain(host.entries),
      onEvent: rebuiltHost.onEvent
    })
    await rebuilt.session.prompt('hi')
    expect(second.calls[0].tools?.map((t) => t.name) ?? []).not.toContain('get_goal')
    expect(lastSnapshot(rebuiltHost.entries)).toMatchObject({ phase: 'blocked', lastStop: { code: 'unsupported_model' } })
  })

  it('after compaction folds earlier rounds, the next round prompt still carries the objective', async () => {
    // Pi's context accounting is anchored on reported usage, so report a prompt-sized input count
    // (like `sizedFinish` in compaction.test.ts); ~1.2k tokens of reply per round crosses a 9k window
    // with reserveTokens 2k after a few rounds.
    const sized = (prompt: unknown): LanguageModelV3StreamPart => {
      const input = Math.ceil(JSON.stringify(prompt).length / 3.5)
      return {
        type: 'finish',
        usage: {
          inputTokens: { total: input, noCache: input, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 1_200, text: 1_200, reasoning: undefined }
        },
        finishReason: { unified: 'stop', raw: 'stop' }
      }
    }
    const { model, calls } = goalModel([
      (prompt, call) => [
        { type: 'text-start', id: 't' },
        { type: 'text-delta', id: 't', delta: `step ${call}: ${'detail '.repeat(600)}` },
        { type: 'text-end', id: 't' },
        sized(prompt)
      ]
    ])
    const host = hostStore()
    const { session } = await createTestSession({
      port: streamTextPort(model).port,
      model: { ...MODEL, contextWindow: 9_000 },
      extensionFactories: [createGoalExtension(goalPort({ defaults: { maxGoalRounds: 8 } }))],
      compaction: { reserveTokens: 2_000, keepRecentTokens: 1_000 },
      onEvent: host.onEvent
    })
    await session.prompt('/goal Finish the OBJECTIVE-MARKER work')

    expect(host.entries.some((e) => e.kind === 'compaction')).toBe(true)
    expect(JSON.stringify(calls.at(-1)!.prompt)).toContain('OBJECTIVE-MARKER')
    expect(lastSnapshot(host.entries)).toMatchObject({ lastStop: { code: 'round_limit' } })
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run --project agent-runtime packages/agent-runtime/tests/goalRebuild.test.ts`
Expected: 第二个 FAIL（没有 `unsupported_model` 快照）；第一、三个应已通过。

- [ ] **Step 3: 实现门控快照**

把任务 4 的 `if (!port.modelSupportsTools()) return` 改成：

```ts
    if (!port.modelSupportsTools()) {
      pi.on('session_start', (_event, ctx) => {
        const goal = currentGoal(ctx.sessionManager.getBranch())
        if (goal && goal.phase === 'active') pi.appendEntry(GOAL_STATE_TYPE, stopGoal(goal, { code: 'unsupported_model', message: 'the current model has no tool calling' }, Date.now()))
      })
      return
    }
```

- [ ] **Step 4: 跑测试确认通过；跑整包**

Run: `pnpm test:agent-runtime && pnpm --filter @cherrystudio/agent-runtime typecheck`
Expected: PASS

- [ ] **Step 5: 格式、lint、提交**

```bash
pnpm exec oxfmt --write packages/agent-runtime/src/goalExtension.ts packages/agent-runtime/tests/goalRebuild.test.ts
pnpm exec oxlint --deny-warnings packages/agent-runtime/src packages/agent-runtime/tests
git add packages/agent-runtime/src/goalExtension.ts packages/agent-runtime/tests/goalRebuild.test.ts
git commit -S --signoff -m "feat(agent-runtime): keep goals consistent across rebuilds and unsupported models"
```

---

### Task 11: README 与收尾

**Files:**
- Modify: `packages/agent-runtime/README.md`（Extensions 一节、Known gaps）

- [ ] **Step 1: 写 README**

在 "## Extensions" 列表末尾加：

```markdown
- **`createGoalExtension(port)`** – a persisted objective the runtime keeps pushing while the
  model is idle. State lives in `cherry.goal` entries (one snapshot per change, a tombstone on
  clear); each round is a `cherry.goal-round` message the host maps to the "round N" header.
  Continuation happens only at `agent_before_settle`, and every stop is the runtime's: round cap
  (the last allowed round is a wrap-up), token or USD budget, no progress (two rounds hint, three
  stop; the same tool call three times is blocked, five times ends the goal), a denied approval or
  a dismissed question, provider errors, abort. `update_goal(complete)` passes the host's
  `GoalVerifier` or, without one, needs evidence and a round that changed something;
  `update_goal(blocked)` needs the same condition in `blockedAfter` consecutive rounds. Tools are
  `get_goal` / `create_goal` / `update_goal` with DSH's output shape; `/goal` manages it without a
  model turn and reports through `cherry.goal-notice` entries. A rebuilt session restores the goal
  disarmed; `/goal resume` continues it. Design: `docs/superpowers/specs/2026-10-11-agent-runtime-goal-design.md`.
```

在 "The host's approval layer…" 段后加一句：

```markdown
The host sets `create_goal` to ask for approval, so a goal the model proposes is confirmed by the
user through the existing approval card.
```

Known gaps 加：

```markdown
- Goals: no `waiting` state for background work (the goal blocks with `waiting_children` when the
  host reports running children), no fresh-context (Ralph) mode, and a subagent's usage is not
  counted toward the parent goal's budget.
```

- [ ] **Step 2: 文档门禁与整包门禁**

Run: `pnpm docs:check && pnpm test:agent-runtime && pnpm --filter @cherrystudio/agent-runtime typecheck && pnpm exec oxlint --deny-warnings packages/agent-runtime && pnpm exec eslint packages/agent-runtime`
Expected: 全部通过。

- [ ] **Step 3: 提交**

```bash
git add packages/agent-runtime/README.md
git commit -S --signoff -m "docs(agent-runtime): document the goal extension"
```

---

## Self-review 记录

- **Spec 覆盖**：§5 数据模型 → 任务 2、3；§6.0 首轮 → 任务 5 `startRound`；§6.2 十一步 → 任务 5 `decide` 加任务 6–9 的分支；§6.3 接纳 → 任务 5；§7.1 上限 → 任务 6；§7.2 无进展 → 任务 7；§7.3 需要人 → 任务 8；§7.4 错误 → 任务 5/8；§7.5 自报 → 任务 9；§7.6 停止压过续跑 → 任务 4（命令里 `ctx.abort()`）和任务 8 的测试；§8 工具命令 → 任务 4；§8.3 门控 → 任务 10；§9 核验 → 任务 9；§10 端口 → 任务 4；§11 衔接 → 任务 10；§13 测试计划 19 条全部落在任务 2–10。
- **spec 相对本计划的三处调整**（已同步进 spec）：快照新增 `progressRounds`；命令反馈走 `cherry.goal-notice` 状态条目；`GoalVerifier` 收 `ConversationModelMessage[]`。
- **类型一致性**：`RoundDetails`、`GoalStopCode`、`GoalPort.defaults` 在任务 2–4 定义，后续任务只引用。`stop()` / `commit()` / `notice()` 的签名贯穿任务 4–10。
- **Review Focus 覆盖**：1 → 任务 5 "yields to a user message"；2 → 任务 4 "rejects a stale revision"；3 → 任务 7 "hints on the third round"；4 → 任务 10 "rebuilt session restores the goal disarmed"；5 → 任务 5 "does not count a round that a later extension vetoed"。
