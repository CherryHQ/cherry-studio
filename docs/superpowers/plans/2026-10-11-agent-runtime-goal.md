# Agent runtime goal 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `packages/agent-runtime` 里实现 Pi 版 goal 扩展：持久目标、`agent_before_settle` 续跑、运行时拥有的全部停止策略、`get_goal / create_goal / update_goal` 工具和 `/goal` 命令。

**Architecture:** 两个源文件。`goalState.ts` 是纯函数：类型、状态迁移、校验、从 branch 读状态、进展判定、提示词。`goalExtension.ts` 用 L3 的扩展工厂模式（`createAskUserExtension` 同款）把它们挂到 Pi 的 `session_start / session_shutdown / turn_start / message_end / tool_call / turn_end / agent_before_settle / agent_settled` 上，所有状态变更都以 `cherry.goal` 自定义条目写入 session，由 L2 的 transcript 往返。宿主只实现 `GoalPort`。

**Tech Stack:** TypeScript、`@earendil-works/pi-coding-agent` 1.1.0 扩展 API、`@earendil-works/pi-ai` 的 TypeBox `Type`、Vitest 5、包内已有的 `tests/support.ts`（`scriptedModel`、`streamTextPort`、`createTestSession`、`hostStore`）。

**Spec:** `docs/superpowers/specs/2026-10-11-agent-runtime-goal-design.md`

**执行时机：** 基于 L4（前台子代理，PR #21578）：分支 `feature/agent-runtime-goal` 已 rebase 到 `feature/agent-runtime-subagent`。任务 1–4 已实现，任务 5–11 待做。任务 5 的 `turn_end` 记账读 L4 放在工具结果上的 `usage`，任务 10 用 L4 的 `isSubagentSession` 让 goal 在子代理里不生效；任务 8 的 `onApproval` / `hasRunningSubagents` 只在包内按端口测试：`onApproval` 由宿主接入 PR 接到 `ToolApprovalRegistry`，`hasRunningSubagents` 等 L6 的后台子代理。

## Global Constraints

- 包不 import `src/`、`@main`、`@shared`、`@logger`、`@application`；不写日志（README "Boundaries"）。
- 每个"停"的决定都由运行时做出，不依赖模型配合（spec §1）。
- 状态变更只通过 `pi.appendEntry('cherry.goal', snapshot)` 持久化；`armed` 永不持久化（spec §5.1）。
- 轮数只在轮被接纳后递增（spec §6.3）：命令发出的轮在它的轮消息的 `message_end`，settle 边界续跑的轮在随后的 `turn_start`（Pi 不为边界提交的条目向扩展发 `message_end`，见任务 5 "Pi 行为"）。
- 人类回合从用户消息的 `message_end` 开始（spec §6.1）；`session.abort()` 之后 Pi 不经过 `agent_before_settle`，中止只在 `agent_settled { aborted: true }` 上可见。
- 处理器需要的 `ctx` 一律显式传参（`decide(event, ctx, …)`、`completeGoal(…, ctx)`、`blockGoal(…, ctx)`）；扩展里没有 `runtime.ctx`。
- 续跑前必须先追加一条 `cherry.goal-round` 消息再返回 `continue: true`（spec §6.2）。
- 工具名、输出形状沿用 DSH：`{ goal: null }` 或 `{ goal, activation }`；空字符串和 0 视为未填（spec §8.1）。
- objective 1–4000 字符；`maxGoalRounds ≤ maxGoalRoundsCeiling`（spec §5.1、§7.1）。
- 默认值：`maxGoalRounds` 100、ceiling 1000、`blockedAfter` 3、无进展 2 轮提示 3 轮停、轮内重复 3 次提示 5 次停（spec §12）。
- 子代理（L4）：工具结果自带的 `usage` 计入 goal 预算，不认工具名（spec §6.1）；`subagent` 算有进展（spec §7.2）；子代理内部的请求不算轮（spec §2）；子代理的 session 里 goal 工具报 `in_subagent`、不续跑、忽略继承来的 goal 状态（spec §8.4）。
- 命名不带 `child`（子代理本来就是 child）：`GoalPort.hasRunningSubagents`、停止码 `waiting_subagents`；代码里的旧名由任务 8 改掉。
- 权限模式按 Claude Code 的五档 auto（默认）/ manual / edit / plan / full，存储值 `auto / default / acceptEdits / plan / bypassPermissions`（spec §3.3）；plan 模式下不续跑归宿主接入 / 权限 PR（spec §1.1），包内不做。
- 测试：每个测试写明破坏什么时失败（任务里的表格或用例上方的 `// Breaks when …`）；不写只记录现状的测试（CLAUDE.md "No behavior-pinning tests"）。`/goal` 命令在它开启的运行结束前就返回，测试一律用 `promptIdle()`（`session.prompt` 后 `session.waitForIdle()`）等运行落定，不 sleep；需要"运行中"的状态时用 `heldModel()` 把模型调用挂住。共用的会话构造和脚本放在 `tests/goalSupport.ts`，不在测试文件里复制。
- 提交：`git -c core.hooksPath=/dev/null commit -S --signoff`（本工作区的 hooks 指向别的工作树，门禁在步骤里显式跑），Conventional Commits，scope `agent-runtime`；提交后用 `git cat-file commit HEAD` 确认有 `gpgsig` 和 `Signed-off-by`。
- 门禁（每个任务结束时，只对改动的文件）：`pnpm exec oxfmt --write <files>`、`pnpm exec vitest run --project agent-runtime <goal 测试文件>`、`pnpm --filter @cherrystudio/agent-runtime typecheck`、`pnpm exec oxlint --deny-warnings <files>`、`pnpm exec eslint <files>`；pnpm 命令串行跑。`oxlint --deny-warnings` 拒绝未使用的 import 和变量，所以每个 import 和助手都在第一个用到它的任务里加。

## Review Focus

spec 没有逐条写、但用户一定会碰到的输入。每条都在所属任务里加了测试：

1. 用户在 goal 轮流式输出时发了普通消息：Pi 在本次运行里就取走它，这一回合是人类回合，用量和计数不算 goal 的；消息恰好在 settle 时等着，goal 必须让路，处理完后继续，且不丢目标（任务 5）。
2. 模型在 `update_goal(complete)` 里给了陈旧 revision（它没先调 `get_goal`）：必须拒绝并附当前视图，不能把目标标完成（任务 4）。
3. 模型每轮只调一次只读工具就停（弱模型常见）：第一轮之后再有三轮无进展必须以 `no_progress` 停下，而不是跑满 100 轮（任务 7）。
4. 应用在 goal 轮中间崩溃，下次打开：目标显示为非武装，不自动续跑，`/goal resume` 能继续；崩溃时最后一轮已用完余量的，`resume` 报错而不是多跑一轮（任务 10、任务 5）。
5. 后加载的扩展把 `continue` 覆盖为 `false`：轮数不能递增，UI 必须看到 `continuation_rejected`（任务 5）。
6. goal 轮里模型把一大块工作交给子代理：子代理的 token 和金额必须计入父 goal 的预算，否则预算形同虚设（任务 5）。
7. goal 轮里模型开了一个 fork 子代理：fork 继承了活跃的 goal，但不能读写它，也不能在 fork 里续跑（任务 10）。
8. 用户按"停本轮"（宿主 `session.abort()`）：Pi 不经过 `agent_before_settle`，goal 必须在 `agent_settled` 上暂停，下一条消息不能把它续起来（任务 8）。
9. 用户在 agent 忙时输入 `/goal <objective>`：只写快照并武装，由本次运行的 settle 开第一轮；命令自己发轮消息会被 Pi 当成 steering 插进人类回合（任务 5）。

## 文件结构

| 文件 | 职责 |
|---|---|
| `packages/agent-runtime-pi/src/goalState.ts` | 纯函数：类型、常量、状态迁移、校验、`currentGoal` / `isHumanTurn` / `tailRound` 读 branch、`isProgressResult`（任务 5 替换 `turnProgress`）、`toolCallKey`、`renderRoundPrompt`、`goalView` |
| `packages/agent-runtime-pi/src/goalExtension.ts` | `GoalPort`、`GoalVerifier`、`createGoalExtension`：工具、命令、事件处理、内存运行态 |
| `packages/agent-runtime-pi/src/askUserExtension.ts` | 加 `outcome` 字段（任务 1） |
| `packages/agent-runtime-pi/src/index.ts` | 导出 |
| `packages/agent-runtime-pi/README.md` | Extensions 一节加 goal |
| `packages/agent-runtime-pi/tests/goalState.test.ts` | 纯函数测试 |
| `packages/agent-runtime-pi/tests/goalSupport.ts` | 测试助手：`goalPort()`、`goalModel()`、`snapshots()`；任务 5 加 `goalSession()` / `openGoalSession()` / `heldGoalSession()`、`heldModel()`、`promptIdle()`、`roundStart()`、`working`、`crashedTranscript()` |
| `packages/agent-runtime-pi/tests/goal.test.ts` | 工具、命令、续跑、接纳 |
| `packages/agent-runtime-pi/tests/goalStops.test.ts` | 上限、预算、无进展、需要人、错误、中止、自报 |
| `packages/agent-runtime-pi/tests/goalRebuild.test.ts` | 门控、重建、压缩、子代理里不生效 |

---

### Task 1: L3 前置：`AskUserQuestionDetails.outcome`

**Files:**
- Modify: `packages/agent-runtime-pi/src/askUserExtension.ts:43-48, 104-135`
- Modify: `packages/agent-runtime-pi/tests/askUser.test.ts`

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

Run: `pnpm exec vitest run --project agent-runtime packages/agent-runtime-pi/tests/askUser.test.ts`
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

Run: `pnpm exec vitest run --project agent-runtime packages/agent-runtime-pi/tests/askUser.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/agent-runtime-pi/src/askUserExtension.ts packages/agent-runtime-pi/tests/askUser.test.ts
git commit -S --signoff -m "feat(agent-runtime): record how an AskUserQuestion call ended in its details"
```

---

### Task 2: `goalState.ts`：类型、迁移、校验

**Files:**
- Create: `packages/agent-runtime-pi/src/goalState.ts`
- Test: `packages/agent-runtime-pi/tests/goalState.test.ts`

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
// packages/agent-runtime-pi/tests/goalState.test.ts
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

Run: `pnpm exec vitest run --project agent-runtime packages/agent-runtime-pi/tests/goalState.test.ts`
Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现**

```ts
// packages/agent-runtime-pi/src/goalState.ts
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

Run: `pnpm exec vitest run --project agent-runtime packages/agent-runtime-pi/tests/goalState.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/agent-runtime-pi/src/goalState.ts packages/agent-runtime-pi/tests/goalState.test.ts
git commit -S --signoff -m "feat(agent-runtime): add goal state transitions and limits"
```

---

### Task 3: `goalState.ts`：读 branch、进展判定、提示词

**Files:**
- Modify: `packages/agent-runtime-pi/src/goalState.ts`
- Test: `packages/agent-runtime-pi/tests/goalState.test.ts`

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

Run: `pnpm exec vitest run --project agent-runtime packages/agent-runtime-pi/tests/goalState.test.ts`
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

Run: `pnpm exec vitest run --project agent-runtime packages/agent-runtime-pi/tests/goalState.test.ts`
Expected: PASS

- [ ] **Step 5: 格式、lint、提交**

```bash
pnpm exec oxfmt --write packages/agent-runtime-pi/src/goalState.ts packages/agent-runtime-pi/tests/goalState.test.ts
pnpm exec oxlint --deny-warnings packages/agent-runtime-pi/src/goalState.ts packages/agent-runtime-pi/tests/goalState.test.ts
git add packages/agent-runtime-pi/src/goalState.ts packages/agent-runtime-pi/tests/goalState.test.ts
git commit -S --signoff -m "feat(agent-runtime): read goal state from the branch and render round prompts"
```

---

### Task 4: 扩展骨架：工具、命令、恢复

**Files:**
- Create: `packages/agent-runtime-pi/src/goalExtension.ts`
- Create: `packages/agent-runtime-pi/tests/goalSupport.ts`
- Create: `packages/agent-runtime-pi/tests/goal.test.ts`
- Modify: `packages/agent-runtime-pi/src/index.ts`

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
// packages/agent-runtime-pi/tests/goalSupport.ts
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
// packages/agent-runtime-pi/tests/goal.test.ts
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

Run: `pnpm exec vitest run --project agent-runtime packages/agent-runtime-pi/tests/goal.test.ts`
Expected: FAIL，`createGoalExtension` 未导出。

- [ ] **Step 4: 实现扩展骨架**

```ts
// packages/agent-runtime-pi/src/goalExtension.ts
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

Run: `pnpm exec vitest run --project agent-runtime packages/agent-runtime-pi/tests/goal.test.ts && pnpm --filter @cherrystudio/agent-runtime typecheck`
Expected: PASS。若 `execute` 的第五个参数类型 `ExtensionToolContext` 不含 `sessionManager`，保持用 `runtime.ctx`（来自 `session_start`、`turn_start`、`tool_call` 事件）读 branch，不要改用它。

- [ ] **Step 6: 格式、lint、提交**

```bash
pnpm exec oxfmt --write packages/agent-runtime-pi/src/goalExtension.ts packages/agent-runtime-pi/src/index.ts packages/agent-runtime-pi/tests/goal.test.ts packages/agent-runtime-pi/tests/goalSupport.ts
pnpm exec oxlint --deny-warnings packages/agent-runtime-pi/src packages/agent-runtime-pi/tests
git add packages/agent-runtime-pi/src/goalExtension.ts packages/agent-runtime-pi/src/index.ts packages/agent-runtime-pi/tests/goal.test.ts packages/agent-runtime-pi/tests/goalSupport.ts
git commit -S --signoff -m "feat(agent-runtime): add goal tools and the /goal command"
```

---

### Task 5: 续跑、预约与接纳、首轮启动、人类回合、让路、每轮确认

**Files:**
- Modify: `packages/agent-runtime-pi/src/goalState.ts`（`tailRound` 越过非消息条目；`turnProgress` 换成 `isProgressResult`）
- Modify: `packages/agent-runtime-pi/src/goalExtension.ts`
- Modify: `packages/agent-runtime-pi/tests/goalSupport.ts`（共享会话、等待和挂起助手）
- Modify: `packages/agent-runtime-pi/tests/goalState.test.ts`
- Modify: `packages/agent-runtime-pi/tests/goal.test.ts`（任务 4 的用例按"命令会开轮"更新，加续跑用例）
- Modify: `docs/superpowers/specs/2026-10-11-agent-runtime-goal-design.md`（§7.6 补限定，C4）

**Interfaces:**
- Consumes：任务 4 的 `runtime`、`commit`、`stop`、`notice`、`create`、`pause`、`resume`、`clear`、`resetGoalRuntime`、`requireHumanTurn`；`goalState` 的 `admitRound`、`assistantText`、`budgetExceeded`、`GOAL_ROUND_TYPE`、`recordUsage`、`renderRoundPrompt`；Pi 的 `AgentBeforeSettleEvent` / `AgentBeforeSettleEventResult`（`@earendil-works/pi-coding-agent` 导出）；L4 放在工具结果上的 `usage`（`ToolResultMessage.usage?: Usage`，随 `turn_end` 的 `toolResults` 到达）。
- Produces：

```ts
// src/goalState.ts
export function tailRound(entries: readonly SessionEntry[]): RoundDetails | undefined // 最后一条 message 条目之后的轮消息
export function isProgressResult(result: ToolResultMessage): boolean // 取代 turnProgress
// src/goalExtension.ts，createGoalExtension 内部
const reserve: (goal: GoalSnapshot) => RoundDetails
const startRound: (ctx: ExtensionContext) => void
const admit: (details: RoundDetails | undefined) => void
const roundProgressed: () => boolean // 任务 9 的退化检查读它
const closeRound: () => void
const startHumanTurn: () => void
const decide: (event: AgentBeforeSettleEvent, ctx: ExtensionContext, goalRoundEnded: boolean) => AgentBeforeSettleEventResult | undefined
// Runtime：`round: { toolProgress; text }` 取代 `lastRoundProgressed`；`blocked: { round; count }` 取代 `blockedRounds`
// tests/goalSupport.ts
export const working: (prompt: LanguageModelV3Prompt, call: number) => LanguageModelV3StreamPart[]
export function roundStart(prompt: LanguageModelV3Prompt): number | undefined
export function heldModel(scripts?): { model; calls: LanguageModelV3CallOptions[]; release(): void; started(n: number): Promise<void>; aborted(n: number): boolean }
export async function openGoalSession(model: LanguageModel, port?: GoalPort, extra?: GoalSessionOptions) // AgentRuntimeSession & { host }
export async function goalSession(scripts, port?, extra?) // … & { calls }
export async function heldGoalSession(port?, extra?, scripts?) // … & { held }
export async function promptIdle(session: AgentSession, text: string): Promise<void>
export async function crashedTranscript(objective: string, port: GoalPort, cwd: string): Promise<TranscriptEntry[]>
```

任务 6–9 在 `decide()`、`turn_end`、`agent_settled` 里加判断；spec §6.2 第 8 条 `hasRunningSubagents` 由任务 8 连同改名一起加，`agent_settled` 上的中止由任务 8 加。

**Pi 行为（已用探针确认）：** 2026-10-13 在 `packages/agent-runtime-pi/tests/` 下放临时探针（真实 `createAgentRuntimeSession` + 记录事件的扩展，跑完删除），结果如下。`goalExtension.ts` 的接纳点、人类回合和测试的等待方式都按这里写：

1. 用户消息启动的运行：`agent_start → turn_start →`（session 第一个 prompt 时还有一条工具声明的 `system` 消息）`→ user 的 message_start / message_end → assistant …`。`turn_start` 时这条用户消息还不在 branch 上；扩展的 `message_end` 处理器跑完之后 Pi 才写 branch，所以处理器里也要读 `event.message`，不读 branch。运行中排进来的 follow-up 同样是 `turn_start → user message_end`。
2. 命令里空闲时 `pi.sendMessage(轮消息, { triggerTurn: true })`：`agent_start` 在 `sendMessage` 里同步发出，之后 `turn_start → (system) → custom 轮消息的 message_end → assistant …`。处理器看到 `message_end` 时轮消息同样还没写进 branch；工具 `execute` 时它已经在 branch 上（工具里的 `isHumanTurn` 照常可用）。
3. `agent_before_settle` 返回 `{ entries: [轮消息草稿], continue: true }`：Pi 在续跑前直接提交草稿，`agent_start` / `turn_start` 时 branch 末尾就是这条轮消息；Pi 不为它向扩展发 `message_start` / `message_end`。
4. 后加载的扩展返回 `{ continue: false }`：我们的草稿照样提交（`rounds(host.entries)` 里看得到这条没跑的轮消息），之后没有 `agent_start` / `turn_start`，直接 `agent_settled`。
5. `await session.prompt('/goal …')` 在命令处理器返回时就 resolve，此时 `isIdle()` 为 false、模型还没被调用；`await session.waitForIdle()` 在 `agent_settled` 处理器跑完后才 resolve。测试用 `promptIdle()`。
6. settle 时已在排队的 follow-up（先加载的扩展在自己的 `agent_before_settle` 里 `await session.prompt(…, { streamingBehavior: 'followUp' })`）：后面的扩展看到 `context.pendingMessages.length === 1`；它若照样续跑，Pi 先发轮消息、再处理 follow-up；它返回 `undefined`，Pi 因为队列非空继续跑 follow-up，之后再到 settle。turn_end 订阅者里排进的 follow-up 在本次运行的循环内就被取走，settle 时 `pendingMessages` 为空（所以原计划的让路测试测不到第 7 条，D2）。
7. `session.abort()`（命令里的 `ctx.abort()` 调的就是它）之后 Pi 跳过 `agent_before_settle`，只发 `agent_settled { aborted: true }`；挂住的模型调用不用放行，运行也会落定。`ExtensionCommandContext.waitForIdle()` 在本包的 session 里是空操作（包不绑定命令上下文动作），命令处理器没法等运行落定。
8. 模型请求失败：`agent_before_settle` 的 `outcome === 'error'`，branch 末尾是带 `errorMessage` 的 assistant 消息。`stopReason === 'length'` 的回复 `outcome` 仍是 `completed`，Pi 可能紧接着追加一条 `context_edit` 条目。
9. 阈值压缩在一轮的运行结束后、`agent_before_settle` 之前进行；下一轮的轮消息落在 compaction 条目之后。
10. 工具循环里每个 turn 都有自己的 `turn_start`，所以轮内重复计数在接纳时清零（spec §7.2），不能在 `turn_start` 清零；两个接纳点（命令轮的 `message_end`、续跑轮的 `turn_start`）都在这一轮第一个 `tool_call` 之前。
11. `pi.appendEntry` 直接写 session：命令轮在 `message_end` 里追加的接纳快照排在这条轮消息之前，续跑轮的排在它之后；测试不要断言二者的先后。

**spec 与 Pi 不符的两处（本任务不改 spec，交 controller 裁定）：**

- spec §4 的事件表和 §6.3 把接纳放在轮消息的 `message_end` 上。Pi 只为命令发出的轮向扩展发这个事件（第 2 条），settle 续跑的轮收不到（第 3 条）。本计划两处都接：命令轮在 `message_end`，续跑轮在随后的 `turn_start` 用 `tailRound` 从 branch 读出。§4 的事件表因此还需要 `turn_start`（任务 8 另加 `session_shutdown`）。
- spec §6.2 第 1 条和 §7.6 第一条说 `session.abort()` 后在 `agent_before_settle` 看到 `outcome: 'aborted'`；实际上 Pi 跳过这个事件（第 7 条），§7.6 第二条"之后 `agent_before_settle` 看到的 phase 已不是 `active`"也不会发生。本计划在 `agent_settled` 上暂停（任务 8），第 1 条保留给端口自己中止请求、Pi 没收到 `session.abort()` 的情形。

**Notes（ledger 带进本任务的条目）：**

- C6 已在代码里（`commit()` 只在 goal id 相同时折入用量）；C11 的 `create()` / `resume()` / `pause()` / `clear()` / `resetGoalRuntime()` 照用。
- C1：`resume()` 先调用 `resumeGoal`（它检查 `complete` 和余量），只在拿到新对象时 `commit`；拿到同一个对象且已武装时返回 false。用例 "resume refuses an active goal that has no round left" 守这一条：崩溃前最后一轮已被接纳的 goal 恢复成"active、未武装、没有余量"。
- C2：没有目标时，开头的 `edit` 是 objective 的一部分；用例 "with no goal, a leading edit is part of a new objective"。
- C9：`not_human_turn` 用例覆盖 `create_goal`、`edit`、`pause`、`resume` 四个动作（S5.1）。
- C10：`tailRound` 从末尾往回走，越过所有非 `message` 条目（其他扩展的草稿、状态条目、`context_edit`、compaction）找我们的轮消息；遇到 `message` 条目就停。
- C13：`subagent` 不在 `NON_PROGRESS_TOOLS` 里；`goalState.test.ts` 加一行断言守它。
- C4：spec §7.6 第二条补上 §8.2 已有的限定（Step 5）。
- 用户裁定（2026-10-13，spec 7be08c2c58）：进展按轮算（任一 turn 有成功的非只读工具调用，或这一轮最后一条带文字的回复与上一轮的不同；只调工具的 turn 不更新"上一轮的文字"）；重复计数在接纳时清零；人类回合清零无进展计数和 blocked 计数，它的用量和工具调用不算 goal 的。
- 预检 Q3 的附带问题（中止后紧接着新建目标）：被中止的运行落定时仍按 §6.2 第 1 条（任务 8 起在 `agent_settled`）暂停这时 `active` 的目标，停止压过续跑。命令等不了运行落定（Pi 行为第 7 条），而 Pi 落定一个中止的运行不等挂住的模型调用，窗口只有那一下；不为此加状态，用户 `/goal resume` 即可。任务 4 的 `'/goal rounds of tests …'` 用例改成在 clear 前等运行落定，不再碰这个窗口。
- `stop('continuation_rejected')` 得到 `phase: 'blocked'`（R2）。

- [ ] **Step 1: 写测试助手和失败的测试**

`tests/goalSupport.ts`：把顶部的 import 换成下面这段（新增 `AgentSession`、`LanguageModel`、`createGoalExtension` 和 `./support` 的会话助手）：

```ts
import type { LanguageModelV3CallOptions, LanguageModelV3Prompt, LanguageModelV3StreamPart } from '@ai-sdk/provider'
import type { AgentSession } from '@earendil-works/pi-coding-agent'
import { type LanguageModel, simulateReadableStream } from 'ai'
import { MockLanguageModelV3 } from 'ai/test'

import {
  createGoalExtension,
  GOAL_NOTICE_TYPE,
  GOAL_ROUND_TYPE,
  GOAL_STATE_TYPE,
  type GoalCleared,
  type GoalNotice,
  type GoalPort,
  type GoalSnapshot,
  type RoundDetails,
  type TranscriptEntry
} from '../src'
import { createTestSession, finish, hostStore, plain, streamTextPort, type TestSessionOptions } from './support'
```

在 `say` 之后插入：

```ts
/** A script whose replies differ per call, so every round counts as progress. */
export const working = (_prompt: LanguageModelV3Prompt, call: number) => say(`working on step ${call}`)

/** The round a request starts, read from its last message (that round's prompt); undefined for any other request. */
export function roundStart(prompt: LanguageModelV3Prompt): number | undefined {
  const last = prompt.at(-1)
  if (last?.role !== 'user') return undefined
  const text = last.content.map((part) => (part.type === 'text' ? part.text : '')).join('')
  const round = text.startsWith('<goal_round>') ? /\nRound: (\d+)\//.exec(text) : null
  return round ? Number(round[1]) : undefined
}

/**
 * A `goalModel` whose calls wait until `release()`, so a test can act while a turn is in flight. An
 * abort settles the run without a release.
 */
export function heldModel(scripts: Parameters<typeof goalModel>[0] = [() => say('done')]) {
  let release!: () => void
  const gate = new Promise<void>((resolve) => (release = resolve))
  const calls: LanguageModelV3CallOptions[] = []
  const waiting: { count: number; resolve: () => void }[] = []
  const model = new MockLanguageModelV3({
    doStream: async (options) => {
      const call = calls.push(options)
      for (const waiter of waiting) if (call >= waiter.count) waiter.resolve()
      await gate
      const script = scripts[Math.min(call - 1, scripts.length - 1)]
      return { stream: simulateReadableStream({ chunks: script(options.prompt, call) }) }
    }
  })
  return {
    model,
    calls,
    release,
    /** Resolves once the `n`th call (from 1) is waiting. */
    started: (n: number) =>
      new Promise<void>((resolve) => (calls.length >= n ? resolve() : waiting.push({ count: n, resolve }))),
    aborted: (n: number) => calls[n - 1]?.abortSignal?.aborted === true
  }
}

type GoalSessionOptions = Omit<TestSessionOptions<undefined>, 'port' | 'onEvent'>

/** A session on `model` with the goal extension loaded after `extra.extensionFactories`, and a host store. */
export async function openGoalSession(
  model: LanguageModel,
  port: GoalPort = goalPort(),
  extra: GoalSessionOptions = {}
) {
  const host = hostStore()
  const runtime = await createTestSession({
    ...extra,
    port: streamTextPort(model).port,
    extensionFactories: [...(extra.extensionFactories ?? []), createGoalExtension(port)],
    onEvent: host.onEvent
  })
  return { ...runtime, host }
}

export async function goalSession(
  scripts: Parameters<typeof goalModel>[0],
  port: GoalPort = goalPort(),
  extra: GoalSessionOptions = {}
) {
  const { model, calls } = goalModel(scripts)
  return { ...(await openGoalSession(model, port, extra)), calls }
}

export async function heldGoalSession(
  port: GoalPort = goalPort(),
  extra: GoalSessionOptions = {},
  scripts?: Parameters<typeof goalModel>[0]
) {
  const held = heldModel(scripts)
  return { ...(await openGoalSession(held.model, port, extra)), held }
}

/** Prompts and waits for the run to settle: a `/goal` command returns before the round it starts ends. */
export async function promptIdle(session: AgentSession, text: string) {
  await session.prompt(text)
  await session.waitForIdle()
}

/**
 * The transcript of a session cut off while round 1 of `/goal <objective>` waits for the model, as an
 * app crash leaves it: the goal is active and that round admitted.
 */
export async function crashedTranscript(objective: string, port: GoalPort, cwd: string) {
  const { session, host, held } = await heldGoalSession(port, { cwd })
  await session.prompt(`/goal ${objective}`)
  await held.started(1)
  return plain(host.entries)
}
```

`tests/goalState.test.ts`：import 里去掉 `turnProgress`，按字母序加 `assistantText` 和 `isProgressResult`；把 "reads a round only when it is the branch tail" 换成

```ts
  it('reads the round committed after the last message, past entries other extensions append', () => {
    expect(tailRound([userEntry('u', 'x'), roundEntry('r', 3)])).toMatchObject({ round: 3, goalId: 'g1' })
    expect(
      tailRound([assistantEntry('a', 'x'), roundEntry('r', 3), otherMessage('o'), stateEntry('s', {})])
    ).toMatchObject({
      round: 3
    })
    expect(tailRound([roundEntry('r', 3), assistantEntry('a', 'y')])).toBeUndefined()
  })
```

把 "counts a successful non-read tool call or a changed reply as progress" 换成下面两条（文字比较移到扩展里按轮做，见 Step 4 的 `closeRound`）：

```ts
  it('counts a successful call to a tool that does more than read or bookkeep as progress', () => {
    expect(isProgressResult(result('read'))).toBe(false)
    expect(isProgressResult(result('todo_write'))).toBe(false)
    expect(isProgressResult(result('edit', true))).toBe(false)
    expect(isProgressResult(result('edit'))).toBe(true)
    // A delegated task is work done in the round (spec §7.2).
    expect(isProgressResult(result('subagent'))).toBe(true)
  })

  it('normalizes reply text so whitespace changes do not count as a new reply', () => {
    expect(assistantText(assistant('  same \n'))).toBe('same')
  })
```

`tests/goal.test.ts`：

1. 删掉文件里的 `session()` 和 `heldSession()`（由 `goalSupport` 的 `goalSession()` / `heldGoalSession()` 取代，D7），文件头换成：

```ts
import type { AgentSession, ExtensionFactory } from '@earendil-works/pi-coding-agent'
import { describe, expect, it } from 'vitest'

import { createGoalExtension } from '../src'
import {
  crashedTranscript,
  goalModel,
  goalNotices,
  goalPort,
  goalSession,
  goalStates,
  heldGoalSession,
  lastSnapshot,
  notices,
  openGoalSession,
  promptIdle,
  readGoal,
  rounds,
  roundStart,
  say,
  snapshots,
  toolCall,
  working
} from './goalSupport'
import { recordingSubagentPort, routedModel, subagentCall } from './subagentSupport'
import { createTestSession, finish, hostStore, streamTextPort, tempDir, textParts } from './support'
import { textOf, toolResults } from './toolResults'

/** One round per command or resume, so command tests see a settled goal. */
const confirmEachRound = goalPort({ defaults: { autonomy: () => 'confirm-each-round' } })
```

2. `describe('goal tools')` 里七个用例的 `session(` 都改成 `goalSession(`。模型在人类回合里建的目标现在会在本次运行里进入 goal 轮（spec §6.0 第 3 行），所以最后两个用例（"refuses an edit that changes nothing…"、"resuming an active goal returns its view…"）的最后一行换成只数轮次之前的快照：

```ts
    // The goal goes on into rounds after this turn; every snapshot before round 1 belongs to the turn.
    expect(snapshots(host.entries).filter((goal) => goal.roundsStarted === 0)).toHaveLength(1)
```

（第二个用例没有那行注释。）

3. 整个 `describe('/goal command')` 换成下面这段。变化：`'edit nothing'` 移出"无目标"列表（C2 之后它会建目标），另起一条用例；建目标的命令改用 `promptIdle` 并用 `confirmEachRound`，等那一轮跑完再断言；`/goal Pause` 用例改成先跑一轮再 `RESUME`；任务 4 的两个 `heldSession` 用例改用 `heldGoalSession`（目标的第一轮就是被挂住的那次调用），"pausing twice" 并入 "pausing an active goal"；加 C1 用例。

```ts
describe('/goal command', () => {
  it('answers control words with a notice when no goal exists, without a model turn', async () => {
    const { session: s, host, calls } = await goalSession([working])
    for (const command of ['pause', 'resume', 'clear', 'rounds 2000', '']) await s.prompt(`/goal ${command}`.trim())

    // Matching the whole list catches a command that answers with no notice, or with two.
    expect(notices(host.entries)).toEqual([
      'No goal is set.',
      'No goal is set.',
      'No goal is set.',
      'No goal is set.',
      'No goal is set. Use /goal <objective> to create one.'
    ])
    expect(calls).toHaveLength(0)
  })

  // Breaks when a leading "edit" is read as the edit command although there is no goal to edit.
  it('with no goal, a leading edit is part of a new objective', async () => {
    const { session: s, host } = await goalSession([working], confirmEachRound)
    await promptIdle(s, '/goal Edit the onboarding docs')
    expect(snapshots(host.entries)[0]).toMatchObject({ objective: 'Edit the onboarding docs' })
    expect(notices(host.entries)).toEqual(['Goal created.'])
  })

  it('reports a cap above the ceiling and an empty objective as errors', async () => {
    const { session: s, host } = await goalSession([working], confirmEachRound)
    await promptIdle(s, '/goal Fix it')
    expect(lastSnapshot(host.entries)).toMatchObject({ objective: 'Fix it' })
    const before = lastSnapshot(host.entries)!
    await s.prompt('/goal rounds 2000')
    expect(goalNotices(host.entries).at(-1)).toEqual({
      text: expect.stringMatching(/between 1 and 1000/),
      level: 'error'
    })
    expect(lastSnapshot(host.entries)).toMatchObject({ revision: before.revision, maxGoalRounds: 100 })
    await s.prompt('/goal edit    ')
    expect(notices(host.entries).at(-1)).toMatch(/1-4000/)
  })

  it('edits the objective, round cap and budget of the current goal', async () => {
    const { session: s, host } = await goalSession([working], confirmEachRound)
    await promptIdle(s, '/goal Fix it')
    await s.prompt('/goal edit Fix the docs\n\n  then the  tests')
    expect(lastSnapshot(host.entries)).toMatchObject({ objective: 'Fix the docs\n\n  then the  tests' })
    await s.prompt('/goal rounds 20')
    expect(lastSnapshot(host.entries)).toMatchObject({ maxGoalRounds: 20 })
    await s.prompt('/goal budget 5000')
    expect(lastSnapshot(host.entries)).toMatchObject({ budget: { tokens: 5000 } })
    await s.prompt('/goal budget $1.5')
    expect(lastSnapshot(host.entries)).toMatchObject({ budget: { tokens: 5000, usd: 1.5 } })
    expect(goalNotices(host.entries).map((notice) => notice.level)).not.toContain('error')
  })

  it('treats rounds and budget as an objective unless a single number follows', async () => {
    const { session: s, host } = await goalSession([working], confirmEachRound)
    await promptIdle(s, '/goal rounds of tests until CI passes')
    expect(lastSnapshot(host.entries)).toMatchObject({ objective: 'rounds of tests until CI passes' })
    await s.prompt('/goal clear')
    await promptIdle(s, '/goal budget the release')
    expect(lastSnapshot(host.entries)).toMatchObject({ objective: 'budget the release' })
  })

  it('matches control words regardless of case', async () => {
    const { session: s, host } = await goalSession([working], confirmEachRound)
    await promptIdle(s, '/goal Fix it')
    await promptIdle(s, '/goal RESUME')
    await s.prompt('/goal Pause')
    expect(notices(host.entries)).toEqual(['Goal created.', 'Goal resumed.', 'Goal is already paused.'])
    expect(rounds(host.entries)).toHaveLength(2)
  })

  // Breaks when the command does not abort the round, or when the aborted run's settle stops the goal a second time.
  it('pausing an active goal stops its round; pausing again appends nothing', async () => {
    const { session: s, host, held } = await heldGoalSession()
    await s.prompt('/goal Fix it')
    await held.started(1)
    const before = snapshots(host.entries).length
    await promptIdle(s, '/goal pause')
    await s.prompt('/goal pause')
    expect(held.aborted(1)).toBe(true)
    expect(snapshots(host.entries)).toHaveLength(before + 1)
    expect(lastSnapshot(host.entries)).toMatchObject({ phase: 'paused', lastStop: { code: 'paused_by_user' } })
    expect(notices(host.entries).slice(-2)).toEqual(['Goal paused.', 'Goal is already paused.'])
  })

  it('reports the goal as status text', async () => {
    const { session: s, host, held } = await heldGoalSession()
    await s.prompt('/goal Fix it')
    await held.started(1)
    await s.prompt('/goal')
    expect(notices(host.entries).at(-1)).toBe('Goal: Fix it\nPhase: active · armed\nRounds: 1/100 · Tokens: 0')
    await promptIdle(s, '/goal pause')
    await s.prompt('/goal')
    expect(notices(host.entries).at(-1)).toBe(
      'Goal: Fix it\nPhase: paused (paused_by_user) · disarmed\nRounds: 1/100 · Tokens: 0'
    )
  })

  it('clearing writes a tombstone, after which the goal is gone', async () => {
    const { session: s, host } = await goalSession([working], confirmEachRound)
    await promptIdle(s, '/goal Fix it')
    const goal = lastSnapshot(host.entries)!
    await s.prompt('/goal clear')
    expect(goalStates(host.entries).at(-1)).toEqual({
      id: goal.id,
      revision: goal.revision + 1,
      cleared: true,
      at: expect.any(Number)
    })
    await s.prompt('/goal')
    expect(notices(host.entries).at(-1)).toBe('No goal is set. Use /goal <objective> to create one.')
  })

  it('a goal created after a clear starts with no usage', async () => {
    const { session: s, host } = await goalSession([working], confirmEachRound)
    await promptIdle(s, '/goal First')
    await s.prompt('/goal clear')
    await promptIdle(s, '/goal Second')
    // First's round used 17 tokens, so there was usage to leak.
    expect(
      snapshots(host.entries)
        .filter((goal) => goal.objective === 'First')
        .at(-1)
    ).toMatchObject({ tokensUsed: 17 })
    expect(snapshots(host.entries).find((goal) => goal.objective === 'Second')).toMatchObject({
      tokensUsed: 0,
      costUsed: 0
    })
  })

  it('clearing a goal that is not active leaves the running turn alone', async () => {
    const { session: s, held } = await heldGoalSession()
    await s.prompt('/goal Fix it')
    await held.started(1)
    await promptIdle(s, '/goal pause')
    const run = s.prompt('go')
    await held.started(2)
    await s.prompt('/goal clear')
    expect(held.aborted(2)).toBe(false)
    held.release()
    await run
  })

  // Breaks when resume re-arms an active goal without checking its capacity: the crash left its only round admitted.
  it('resume refuses an active goal that has no round left', async () => {
    const cwd = tempDir('cwd')
    const transcript = await crashedTranscript('Keep working', goalPort({ defaults: { maxGoalRounds: 1 } }), cwd)
    const { session: s, host, calls } = await goalSession([working], goalPort(), { cwd, transcript })
    await promptIdle(s, '/goal resume')
    expect(goalNotices(host.entries)).toEqual([
      { text: 'raise max_goal_rounds or the budget before resuming', level: 'error' }
    ])
    expect(calls).toHaveLength(0)
  })
})
```

4. 文件末尾追加：

```ts
describe('goal continuation', () => {
  // Breaks when the command does not start a run, a round is admitted twice, or the model does not get the round prompt.
  it('an idle /goal starts round 1 and each settle pushes one more round', async () => {
    const { session: s, host, calls } = await goalSession([working], goalPort({ defaults: { maxGoalRounds: 3 } }))
    await promptIdle(s, '/goal Keep working')

    // The command started the run itself: the round prompt is the request's only user message.
    expect(calls[0].prompt.filter((message) => message.role === 'user')).toHaveLength(1)
    expect(calls.map((call) => roundStart(call.prompt))).toEqual([1, 2, 3])
    expect(rounds(host.entries).map((round) => round.round)).toEqual([1, 2, 3])
    expect(lastSnapshot(host.entries)).toMatchObject({ roundsStarted: 3 })
  })

  // Breaks when a round counts at its reservation instead of its admission.
  it('does not count a round that a later extension vetoed', async () => {
    const { model, calls } = goalModel([working])
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
    await promptIdle(s, '/goal Keep working')

    expect(calls).toHaveLength(1)
    expect(lastSnapshot(host.entries)).toMatchObject({
      phase: 'blocked',
      roundsStarted: 1,
      lastStop: { code: 'continuation_rejected' }
    })
  })

  // Breaks without spec §6.2 step 7: Pi would send the round before the waiting message, or the goal would end there.
  it('yields to a user message waiting at the settle and continues after it', async () => {
    const user: { session?: AgentSession } = {}
    let asked = false
    // Loaded before the goal extension, so the message is already waiting when the goal decides.
    const askAtFirstSettle: ExtensionFactory = (pi) => {
      pi.on('agent_before_settle', async () => {
        if (asked) return
        asked = true
        await user.session!.prompt('a question from the user', { streamingBehavior: 'followUp' })
      })
    }
    const opened = await goalSession([working], goalPort({ defaults: { maxGoalRounds: 3 } }), {
      extensionFactories: [askAtFirstSettle]
    })
    user.session = opened.session
    await promptIdle(opened.session, '/goal Keep working')

    expect(opened.calls.map((call) => roundStart(call.prompt))).toEqual([1, undefined, 2, 3])
    expect(JSON.stringify(opened.calls[1].prompt.at(-1))).toContain('a question from the user')
    expect(lastSnapshot(opened.host.entries)).toMatchObject({ roundsStarted: 3, lastStop: { code: 'round_limit' } })
  })

  // Breaks when a human turn is looked for at turn_start (the user message is not on the branch yet): its reply would be billed.
  it('a user message taken in during a goal run is a human turn, not billed to the goal', async () => {
    const { session: s, host, calls } = await goalSession([working], goalPort({ defaults: { maxGoalRounds: 2 } }))
    let asked = false
    s.subscribe((event) => {
      if (event.type !== 'turn_end' || asked) return
      asked = true
      void s.prompt('a question from the user', { streamingBehavior: 'followUp' })
    })
    await promptIdle(s, '/goal Keep working')

    expect(calls.map((call) => roundStart(call.prompt))).toEqual([1, undefined, 2])
    // Two round replies of 17 tokens (`finish`: 10 + 2 cached input, 5 output); the question's reply is not the goal's.
    expect(lastSnapshot(host.entries)).toMatchObject({
      roundsStarted: 2,
      tokensUsed: 34,
      lastStop: { code: 'round_limit' }
    })
  })

  it('in confirm-each-round mode each round ends paused and /goal resume runs one more', async () => {
    const { session: s, host, calls } = await goalSession([working], confirmEachRound)
    await promptIdle(s, '/goal Keep working')
    expect(lastSnapshot(host.entries)).toMatchObject({
      roundsStarted: 1,
      phase: 'paused',
      lastStop: { code: 'paused_each_round' }
    })

    await promptIdle(s, '/goal resume')
    expect(lastSnapshot(host.entries)).toMatchObject({
      roundsStarted: 2,
      phase: 'paused',
      lastStop: { code: 'paused_each_round' }
    })
    expect(calls).toHaveLength(2)
  })

  it('a goal the model creates in a human turn continues in that run', async () => {
    const { session: s, host } = await goalSession(
      [() => [toolCall('c1', 'create_goal', { objective: 'g' }), finish('tool-calls')], working],
      goalPort({ defaults: { maxGoalRounds: 2 } })
    )
    await s.prompt('please do g')
    expect(rounds(host.entries).map((round) => round.round)).toEqual([1, 2])
    expect(lastSnapshot(host.entries)).toMatchObject({ lastStop: { code: 'round_limit' } })
  })

  // Breaks when a command typed while the agent is busy sends a round of its own: Pi would deliver it
  // as a steering message inside the human turn, before the model's next reply.
  it("a command typed during a human turn only arms the goal; that turn's settle starts round 1", async () => {
    const {
      session: s,
      host,
      held
    } = await heldGoalSession(goalPort({ defaults: { maxGoalRounds: 2 } }), {}, [
      () => [toolCall('look', 'get_goal', {}), finish('tool-calls')],
      working
    ])
    const run = s.prompt('hello')
    await held.started(1)
    await s.prompt('/goal Keep working')
    held.release()
    await run

    // The human turn's tool call and reply, then rounds 1 and 2.
    expect(held.calls.map((call) => roundStart(call.prompt))).toEqual([undefined, undefined, 1, 2])
    expect(rounds(host.entries).map((round) => round.round)).toEqual([1, 2])
  })

  // Breaks when the human-turn check misses the goal round message (spec §8.1).
  it('refuses create, edit, pause and resume in a goal round', async () => {
    const { session: s } = await goalSession(
      [
        () => [toolCall('g', 'get_goal', {}), finish('tool-calls')],
        (prompt) => {
          const { goal } = readGoal(prompt)
          const ref = { goal_id: goal!.id, revision: goal!.revision }
          return [
            toolCall('create', 'create_goal', { objective: 'another' }),
            toolCall('edit', 'update_goal', { ...ref, action: 'edit', objective: 'changed' }),
            toolCall('pause', 'update_goal', { ...ref, action: 'pause' }),
            toolCall('resume', 'update_goal', { ...ref, action: 'resume' }),
            finish('tool-calls')
          ]
        },
        () => say('ok')
      ],
      goalPort({ defaults: { maxGoalRounds: 1 } })
    )
    await promptIdle(s, '/goal Keep working')
    const refused = toolResults(s).filter((result) => result.toolCallId !== 'g')
    expect(refused.map((result) => [result.toolCallId, result.isError])).toEqual([
      ['create', true],
      ['edit', true],
      ['pause', true],
      ['resume', true]
    ])
    for (const result of refused) expect(textOf(result)).toMatch(/needs a direct human request/)
  })

  // Breaks when turn_end counts only the assistant message's usage: the parent's 17 tokens per reply never reach the budget.
  it('counts the usage a subagent result reports toward the goal budget', async () => {
    const { model } = routedModel(({ userText, lastRole }) => {
      if (userText.includes('TASK-SUB')) return [...textParts('r', 'REPORT'), finish('stop', 1_000, 500)]
      if (lastRole !== 'user') return [...textParts('d', 'Delegated the check.'), finish('stop')]
      return userText.includes('Do not start new work')
        ? [...textParts('w', 'Summary: the check ran in a subagent.'), finish('stop')]
        : [subagentCall('sub_1', { description: 'Check', prompt: 'TASK-SUB' }), finish('tool-calls')]
    })
    const { session: s, host } = await openGoalSession(
      model,
      goalPort({ defaults: { maxGoalRounds: 3, budget: { tokens: 1_000 } } }),
      { subagents: recordingSubagentPort().port }
    )
    await promptIdle(s, '/goal Keep working')

    expect(rounds(host.entries).map((round) => round.kind)).toEqual(['work', 'wrap-up'])
    // Three parent replies of 17 tokens and $0.0000202 each; the subagent's one reply has 1000 + 2
    // cached input and 500 output tokens, $0.0020002 at MODEL's prices.
    expect(lastSnapshot(host.entries)).toMatchObject({
      phase: 'blocked',
      tokensUsed: 1553,
      lastStop: { code: 'budget_exhausted' }
    })
    expect(lastSnapshot(host.entries)!.costUsed).toBeCloseTo(0.0020608, 10)
  })
})
```

每个用例破坏什么时失败（写这份计划前已在临时副本上逐条做过变异：改掉对应实现，该用例失败）：

| 用例 | 破坏什么时失败 |
|---|---|
| goal tools 最后两条 | 无字段的 `edit`、已武装的 `resume` 追加了快照（都在 `roundsStarted === 0` 时） |
| answers control words with a notice when no goal exists | 某个命令不回或回两条；无目标时发了模型请求 |
| with no goal, a leading edit is part of a new objective | 无目标时 `edit` 仍走编辑分支，回 "No goal is set."（C2） |
| reports a cap above the ceiling… / edits the objective… / treats rounds and budget… / clearing writes a tombstone… | 同任务 4（命令解析和写入）；现在在目标真的跑过一轮之后 |
| matches control words regardless of case | 控制词大小写敏感：`RESUME` 不开轮，`Pause` 变成 objective 报 goal_exists |
| pausing an active goal stops its round; pausing again appends nothing | pause 不中止本轮；第二次 pause 追加快照 |
| reports the goal as status text | 状态文本格式、轮数或 activation 错 |
| a goal created after a clear starts with no usage | 新目标带上旧目标的用量（R4）；旧目标确有 17 token 用量 |
| clearing a goal that is not active leaves the running turn alone | 非 `active` 目标的 clear 中止了人类回合 |
| resume refuses an active goal that has no round left | `resume()` 对 active 目标跳过 `resumeGoal` 的余量检查（C1） |
| an idle /goal starts round 1 and each settle pushes one more round | 命令不开轮；同一轮被接纳两次；模型收不到轮提示 |
| does not count a round that a later extension vetoed | 在预约时就递增 `roundsStarted` |
| yields to a user message waiting at the settle and continues after it | 去掉 §6.2 第 7 条（Pi 先发轮消息，调用顺序变成 1, 2, 提问, 3），或让路后目标没再续跑 |
| a user message taken in during a goal run is a human turn, not billed to the goal | 在 `turn_start` 读 branch 判断人类回合（X2）：提问的回复记进 goal，`tokensUsed` 变成 51 |
| in confirm-each-round mode each round ends paused… | 模式不生效；空闲时 `/goal resume` 不开轮 |
| a goal the model creates in a human turn continues in that run | 工具武装的目标没在本次 settle 续跑 |
| a command typed during a human turn only arms the goal… | 忙时命令自己发轮消息：Pi 当作 steering 插在人类回合的工具结果之后 |
| refuses create, edit, pause and resume in a goal round | 人类回合判断看不到轮消息（S5.1、C9） |
| counts the usage a subagent result reports toward the goal budget | `turn_end` 只计 assistant 消息的 usage：父代理每次 17 token 到不了预算，跑满上限 |
| goalState：reads the round committed after the last message… | `tailRound` 只看 branch 末尾，另一个扩展的条目排在后面时接纳不到 |
| goalState：counts a successful call to a tool that does more than read… | 只读工具算进展，或 `subagent` 被放进只读集合（C13） |
| goalState：normalizes reply text… | 只有空白不同的回复被当成新回复 |

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run --project agent-runtime packages/agent-runtime-pi/tests/goal.test.ts packages/agent-runtime-pi/tests/goalState.test.ts`
Expected: FAIL。`goalState.test.ts` 引用不存在的 `isProgressResult`；`goal continuation` 全部失败（没有任何模型调用和轮条目）；C1、C2 和 "matches control words" 失败；三个 `heldGoalSession` 用例超时（命令还不开轮，`held.started(1)` 不会 resolve）。

- [ ] **Step 3: 改 `goalState.ts`**

`tailRound` 换成：

```ts
/**
 * The goal round message after the branch's last message entry: one Pi has committed but not sent
 * yet. Other extensions' entries may follow it.
 */
export function tailRound(entries: readonly SessionEntry[]): RoundDetails | undefined {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i]
    if (entry.type === 'message') return undefined
    if (entry.type === 'custom_message' && isRoundMessage(entry)) return entry.details as RoundDetails
  }
  return undefined
}
```

`turnProgress` 换成下面这个（它只剩工具一半，文字比较按轮放进扩展）：

```ts
/** A tool result that moved the objective: it succeeded, and its tool does more than read or bookkeep. */
export function isProgressResult(result: ToolResultMessage): boolean {
  return result.isError !== true && !NON_PROGRESS_TOOLS.has(result.toolName)
}
```

`AssistantMessage` 仍被 `assistantText` 用着，import 不变。

- [ ] **Step 4: 改 `goalExtension.ts`**

1. 顶部 import 换成：

```ts
import { StringEnum, Type } from '@earendil-works/pi-ai'
import {
  type AgentBeforeSettleEvent,
  type AgentBeforeSettleEventResult,
  type AgentToolResult,
  type ExtensionContext,
  type ExtensionFactory
} from '@earendil-works/pi-coding-agent'

import {
  admitRound,
  assistantText,
  budgetExceeded,
  createGoal,
  currentGoal,
  editGoal,
  GOAL_NOTICE_TYPE,
  GOAL_ROUND_TYPE,
  GOAL_STATE_TYPE,
  type GoalBudget,
  GoalError,
  type GoalNotice,
  type GoalSnapshot,
  type GoalStopCode,
  goalView,
  isHumanTurn,
  isProgressResult,
  recordUsage,
  renderRoundPrompt,
  resumeGoal,
  type RoundDetails,
  stopGoal,
  tailRound
} from './goalState'
import type { ConversationModelMessage } from './modelMessages'
```

2. `NUMBER` 之后加：

```ts
/** Rounds without progress before a hint round, and before the goal stops (spec §7.2). */
const HINT_AFTER_ROUNDS = 2
const STOP_AFTER_ROUNDS = 3
```

3. `interface Runtime` 换成（`round` 取代 `lastRoundProgressed`，`blocked` 取代按 revision 记的 `blockedRounds`，见 spec §7.5）：

```ts
interface Runtime {
  goal: GoalSnapshot | undefined
  armed: boolean
  /** The turn(s) since the last admitted round belong to a goal round. */
  inGoalRound: boolean
  reservation: RoundDetails | undefined
  noProgressRounds: number
  /** The previous round's last text-bearing reply, normalized (spec §6.1). */
  previousText: string | undefined
  /** The current round so far: whether a call moved the objective, and its last text-bearing reply. */
  round: { toolProgress: boolean; text: string | undefined }
  repeat: { key: string | undefined; count: number }
  stopRequest: { code: GoalStopCode; message?: string } | undefined
  /** `count` consecutive goal rounds, the last one `round`, reported `blocked` (spec §7.5). */
  blocked: { round: number; count: number }
  /** Usage since the last snapshot write; folded into the next one. */
  pendingUsage: { tokens: number; usd: number }
}
```

4. `const runtime: Runtime = {…}` 到 `resetGoalRuntime` 结束换成：

```ts
    const runtime: Runtime = {
      goal: undefined,
      armed: false,
      inGoalRound: false,
      reservation: undefined,
      noProgressRounds: 0,
      previousText: undefined,
      round: { toolProgress: false, text: undefined },
      repeat: { key: undefined, count: 0 },
      stopRequest: undefined,
      blocked: { round: 0, count: 0 },
      pendingUsage: { tokens: 0, usd: 0 }
    }
    const limits = () => ({
      maxGoalRounds: port.defaults.maxGoalRounds,
      maxGoalRoundsCeiling: port.defaults.maxGoalRoundsCeiling,
      budget: port.defaults.budget
    })
    const now = () => Date.now()

    /** Per-goal runtime state starts over whenever the goal changes identity or re-arms. */
    const resetGoalRuntime = () => {
      runtime.pendingUsage = { tokens: 0, usd: 0 }
      runtime.reservation = undefined
      runtime.noProgressRounds = 0
      runtime.previousText = undefined
      runtime.round = { toolProgress: false, text: undefined }
      runtime.repeat = { key: undefined, count: 0 }
      runtime.stopRequest = undefined
      runtime.blocked = { round: 0, count: 0 }
    }
```

5. `resume` 换成（C1）：

```ts
    /** False when the goal already was active and armed; `resumeGoal` throws when it is complete or has no capacity. */
    const resume = (goal: GoalSnapshot): boolean => {
      const next = resumeGoal(goal, now())
      if (next === goal && runtime.armed) return false
      if (next !== goal) commit(next)
      resetGoalRuntime()
      runtime.armed = true
      return true
    }
```

6. 在 `blockGoal` 占位之后、`pi.registerCommand('goal', …)` 之前加：

```ts
    const roundMessage = (goal: GoalSnapshot, details: RoundDetails) => ({
      customType: GOAL_ROUND_TYPE,
      content: renderRoundPrompt(goal, details, port.defaults.blockedAfter, runtime.noProgressRounds),
      display: false,
      details
    })
    /** Spec §6.2 step 10: the last allowed round, or the first after the budget is crossed, is a wrap-up. */
    const reserve = (goal: GoalSnapshot): RoundDetails => {
      const kind =
        goal.roundsStarted + 1 >= goal.maxGoalRounds || budgetExceeded(goal)
          ? 'wrap-up'
          : runtime.noProgressRounds === HINT_AFTER_ROUNDS
            ? 'hint'
            : 'work'
      runtime.reservation = { goalId: goal.id, revision: goal.revision, round: goal.roundsStarted + 1, kind }
      return runtime.reservation
    }
    /** Spec §6.0: a command that arms the goal on an idle session starts the first round itself. */
    const startRound = (ctx: ExtensionContext) => {
      if (!runtime.goal || !runtime.armed || !ctx.isIdle()) return
      pi.sendMessage(roundMessage(runtime.goal, reserve(runtime.goal)), { triggerTurn: true })
    }
    /** Spec §6.3: a reserved round counts once Pi sends its message on. */
    const admit = (details: RoundDetails | undefined) => {
      const reserved = runtime.reservation
      if (!runtime.goal || !reserved || !details) return
      if (
        details.goalId !== reserved.goalId ||
        details.revision !== reserved.revision ||
        details.round !== reserved.round
      )
        return
      runtime.reservation = undefined
      runtime.inGoalRound = true
      runtime.round = { toolProgress: false, text: undefined }
      runtime.repeat = { key: undefined, count: 0 }
      commit(admitRound(runtime.goal, reserved.kind, now()))
    }
    const roundProgressed = () =>
      runtime.round.toolProgress || (runtime.round.text !== undefined && runtime.round.text !== runtime.previousText)
    /** Spec §6.1, §7.2: a round ends at the settle or when a person speaks; any progressing turn counts for it. */
    const closeRound = () => {
      if (!runtime.inGoalRound || !runtime.goal) return
      runtime.inGoalRound = false
      const progressed = roundProgressed()
      if (runtime.round.text !== undefined) runtime.previousText = runtime.round.text
      runtime.noProgressRounds = progressed ? 0 : runtime.noProgressRounds + 1
      if (progressed) runtime.goal = recordUsage(runtime.goal, { tokens: 0, usd: 0 }, true)
    }
    /** Spec §6.1: a person's message ends the goal round and starts the streaks over. */
    const startHumanTurn = () => {
      closeRound()
      runtime.noProgressRounds = 0
      runtime.blocked = { round: 0, count: 0 }
    }
    const lastErrorMessage = (ctx: ExtensionContext) => {
      const last = ctx.sessionManager.getBranch().at(-1)
      return last?.type === 'message' && last.message.role === 'assistant' ? last.message.errorMessage : undefined
    }

    /** Spec §6.2, in order; `undefined` lets the run settle. */
    const decide = (
      event: AgentBeforeSettleEvent,
      ctx: ExtensionContext,
      goalRoundEnded: boolean
    ): AgentBeforeSettleEventResult | undefined => {
      const goal = runtime.goal
      if (event.outcome === 'aborted') {
        if (goal?.phase === 'active') stop('aborted')
        return undefined
      }
      if (event.outcome === 'error') {
        if (goal?.phase === 'active') stop('provider_error', lastErrorMessage(ctx))
        return undefined
      }
      if (!goal || goal.phase !== 'active') return undefined
      if (runtime.stopRequest) {
        const { code, message } = runtime.stopRequest
        runtime.stopRequest = undefined
        stop(code, message)
        return undefined
      }
      if (!runtime.armed) return undefined
      if (goalRoundEnded && port.defaults.autonomy() === 'confirm-each-round') {
        stop('paused_each_round')
        return undefined
      }
      if (event.context.pendingMessages.length > 0) return undefined
      if (runtime.noProgressRounds >= STOP_AFTER_ROUNDS) {
        stop('no_progress')
        return undefined
      }
      if (goal.wrapUpDone) {
        stop(goal.roundsStarted >= goal.maxGoalRounds ? 'round_limit' : 'budget_exhausted')
        return undefined
      }
      // The budget check sees this round's usage; the next snapshot write folds it in.
      const projected = recordUsage(goal, runtime.pendingUsage, false)
      return { entries: [{ type: 'custom_message', ...roundMessage(projected, reserve(projected)) }], continue: true }
    }

    // A round the settle committed is on the branch when its run starts; Pi emits no message_end for it.
    pi.on('turn_start', (_event, ctx) => admit(tailRound(ctx.sessionManager.getBranch())))
    pi.on('message_end', (event) => {
      const { message } = event
      if (message.role === 'user') startHumanTurn()
      // A round a command sent: its message_end comes after turn_start, before Pi persists it.
      else if (message.role === 'custom' && message.customType === GOAL_ROUND_TYPE)
        admit(message.details as RoundDetails)
    })

    pi.on('turn_end', (event) => {
      if (!runtime.goal || !runtime.inGoalRound || event.message.role !== 'assistant') return
      const { usage } = event.message
      runtime.pendingUsage.tokens += usage.input + usage.output + usage.cacheRead + usage.cacheWrite
      runtime.pendingUsage.usd += usage.cost.total
      for (const result of event.toolResults) {
        // A tool's own usage (a subagent's requests) counts too: the host billed it, the budget has not seen it.
        if (result.usage) {
          runtime.pendingUsage.tokens += result.usage.totalTokens
          runtime.pendingUsage.usd += result.usage.cost.total
        }
        if (isProgressResult(result)) runtime.round.toolProgress = true
      }
      const reply = assistantText(event.message)
      if (reply) runtime.round.text = reply
    })

    pi.on('agent_before_settle', (event, ctx) => {
      const goalRoundEnded = runtime.inGoalRound
      closeRound()
      return decide(event, ctx, goalRoundEnded)
    })

    pi.on('agent_settled', () => {
      const rejected = runtime.reservation !== undefined
      runtime.reservation = undefined
      runtime.inGoalRound = false
      if (rejected && runtime.goal?.phase === 'active') stop('continuation_rejected')
    })
```

7. 命令处理器里三处：`resume` 分支的 `// Task 5 starts the first round …` 换成 `startRound(ctx)`；创建分支末尾的同一句注释换成 `startRound(ctx)`；`edit` 分支换成（C2）：

```ts
          // With no goal to edit, a leading "edit" is part of a new objective.
          if (keyword === 'edit' && runtime.goal) {
            commit(editGoal(runtime.goal, { objective: value }, port.defaults.maxGoalRoundsCeiling, now()))
            notice('Goal objective updated.')
            return
          }
```

`decide()` 的判断顺序就是 spec §6.2 的顺序；预算判断读的是 `projected`（`pendingUsage` 折进去的副本），真正的折入发生在随后那次 `commit()`（停下或接纳），不在 `decide()` 里重复 `commit()` 的两行（D8）。无进展（第 9 条）排在预算（第 10 条）之前，所以测试里凡是要验证 `round_limit` / `budget_exhausted` 的场景，每轮回复都要不同（`working`），否则先以 `no_progress` 停下。

- [ ] **Step 5: spec §7.6 补限定（C4）**

`docs/superpowers/specs/2026-10-11-agent-runtime-goal-design.md` §7.6 第二条的"再调用 `ctx.abort()` 中止当前轮"改成"再在 goal 原为 `active` 且 agent 正忙时调用 `ctx.abort()` 中止当前轮"（与 §8.2 一致）。上面"spec 与 Pi 不符"的两处不在这里改。

- [ ] **Step 6: 跑测试确认通过**

Run: `pnpm exec vitest run --project agent-runtime packages/agent-runtime-pi/tests/goal.test.ts packages/agent-runtime-pi/tests/goalState.test.ts && pnpm --filter @cherrystudio/agent-runtime typecheck`
Expected: PASS（goal.test.ts 28 个、goalState.test.ts 31 个）。

- [ ] **Step 7: 格式、lint、提交**

```bash
pnpm exec oxfmt --write packages/agent-runtime-pi/src/goalState.ts packages/agent-runtime-pi/src/goalExtension.ts packages/agent-runtime-pi/tests/goalSupport.ts packages/agent-runtime-pi/tests/goalState.test.ts packages/agent-runtime-pi/tests/goal.test.ts
pnpm exec oxlint --deny-warnings packages/agent-runtime-pi/src/goalState.ts packages/agent-runtime-pi/src/goalExtension.ts packages/agent-runtime-pi/tests/goalSupport.ts packages/agent-runtime-pi/tests/goalState.test.ts packages/agent-runtime-pi/tests/goal.test.ts
pnpm exec eslint packages/agent-runtime-pi/src/goalState.ts packages/agent-runtime-pi/src/goalExtension.ts packages/agent-runtime-pi/tests/goalSupport.ts packages/agent-runtime-pi/tests/goalState.test.ts packages/agent-runtime-pi/tests/goal.test.ts
git add packages/agent-runtime-pi/src/goalState.ts packages/agent-runtime-pi/src/goalExtension.ts packages/agent-runtime-pi/tests/goalSupport.ts packages/agent-runtime-pi/tests/goalState.test.ts packages/agent-runtime-pi/tests/goal.test.ts docs/superpowers/specs/2026-10-11-agent-runtime-goal-design.md
git -c core.hooksPath=/dev/null commit -S --signoff -m "feat(agent-runtime): continue goals at the settle boundary and count admitted rounds"
git cat-file commit HEAD | grep -E '^gpgsig|Signed-off-by'
```

---

### Task 6: 轮数上限与预算

**Files:**
- Modify: `packages/agent-runtime-pi/src/goalState.ts`（`editGoal` 只在有余量时恢复 `active`，C3）
- Modify: `packages/agent-runtime-pi/tests/goalState.test.ts`
- Create: `packages/agent-runtime-pi/tests/goalStops.test.ts`

**Interfaces:**
- Consumes：任务 5 的 `decide()` / `reserve()`、`goalSupport` 的 `goalSession` / `promptIdle` / `working`；`MODEL.cost = { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 0 }`（`tests/support.ts`，单价按每百万 token）；`finish(unified, input = 10, output = 5)` 给每次回复 `input + 2` 个输入 token（其中 2 个 cacheRead）和 `output` 个输出 token，即每次 17 token、$0.0000202。
- Produces：`editGoal(goal, patch, ceiling, now)` 签名不变，`round_limit` / `budget_exhausted` 的目标只在 `hasCapacity(edited)` 时回到 `active`。

**Notes（ledger）：** C3 带进本任务：只调高轮数上限的 `budget_exhausted` 目标、只调高预算的 `round_limit` 目标都必须保持 `blocked`，否则会出现"active 但没有余量"的目标（`resume` 再多跑一轮）。

- [ ] **Step 1: 写失败的测试（C3）**

追加到 `tests/goalState.test.ts` 的 `describe('goal limit rules')`，放在 "raising the cap does not re-activate a goal paused by %s" 之前：

```ts
  // Breaks when editGoal re-activates on any raised limit: the goal would be active without capacity.
  it('raising only the cap leaves a budget_exhausted goal blocked while the budget stays crossed', () => {
    let goal = admitRound(createGoal('g', limits, { maxGoalRounds: 1, budget: { tokens: 50 } }, 1), 'wrap-up', 2)
    goal = stopGoal(recordUsage(goal, { tokens: 60, usd: 0 }, true), { code: 'budget_exhausted' }, 3)
    expect(editGoal(goal, { maxGoalRounds: 5 }, 1000, 4)).toMatchObject({
      phase: 'blocked',
      lastStop: { code: 'budget_exhausted' }
    })
  })

  it('raising only the budget leaves a round_limit goal blocked while no round is left', () => {
    let goal = admitRound(createGoal('g', limits, { maxGoalRounds: 1, budget: { tokens: 50 } }, 1), 'wrap-up', 2)
    goal = stopGoal(recordUsage(goal, { tokens: 60, usd: 0 }, true), { code: 'round_limit' }, 3)
    expect(editGoal(goal, { budget: { tokens: 100 } }, 1000, 4)).toMatchObject({
      phase: 'blocked',
      lastStop: { code: 'round_limit' }
    })
  })
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run --project agent-runtime packages/agent-runtime-pi/tests/goalState.test.ts`
Expected: FAIL，两条新用例拿到 `phase: 'active'`。

- [ ] **Step 3: 实现**

`editGoal` 最后一行换成：

```ts
  return closedByLimit && hasCapacity(reopened) ? reactivate(reopened) : reopened
```

Run: `pnpm exec vitest run --project agent-runtime packages/agent-runtime-pi/tests/goalState.test.ts`
Expected: PASS

```bash
pnpm exec oxfmt --write packages/agent-runtime-pi/src/goalState.ts packages/agent-runtime-pi/tests/goalState.test.ts
pnpm exec oxlint --deny-warnings packages/agent-runtime-pi/src/goalState.ts packages/agent-runtime-pi/tests/goalState.test.ts
pnpm exec eslint packages/agent-runtime-pi/src/goalState.ts packages/agent-runtime-pi/tests/goalState.test.ts
git add packages/agent-runtime-pi/src/goalState.ts packages/agent-runtime-pi/tests/goalState.test.ts
git -c core.hooksPath=/dev/null commit -S --signoff -m "fix(agent-runtime): reopen a goal a limit closed only when it has capacity again"
git cat-file commit HEAD | grep -E '^gpgsig|Signed-off-by'
```

- [ ] **Step 4: 写上限与预算的测试**

```ts
// packages/agent-runtime-pi/tests/goalStops.test.ts
import { describe, expect, it } from 'vitest'

import { goalPort, goalSession, lastSnapshot, notices, promptIdle, rounds, toolCall, working } from './goalSupport'
import { finish, MODEL } from './support'
import { textOf, toolResults } from './toolResults'

describe('goal caps and budgets', () => {
  it('runs the last allowed round as a wrap-up, then blocks with round_limit', async () => {
    const { session: s, host, calls } = await goalSession([working], goalPort({ defaults: { maxGoalRounds: 3 } }))
    await promptIdle(s, '/goal Keep working')

    expect(rounds(host.entries).map((round) => round.kind)).toEqual(['work', 'work', 'wrap-up'])
    expect(JSON.stringify(calls.at(-1)!.prompt.at(-1))).toContain('Do not start new work')
    expect(lastSnapshot(host.entries)).toMatchObject({
      phase: 'blocked',
      roundsStarted: 3,
      wrapUpDone: true,
      lastStop: { code: 'round_limit' }
    })
  })

  it('after round_limit, resume is refused until the cap is raised, then one more round runs', async () => {
    const { session: s, host } = await goalSession([working], goalPort({ defaults: { maxGoalRounds: 1 } }))
    await promptIdle(s, '/goal Keep working')
    expect(lastSnapshot(host.entries)).toMatchObject({ roundsStarted: 1, lastStop: { code: 'round_limit' } })

    await promptIdle(s, '/goal resume')
    expect(notices(host.entries).at(-1)).toBe('raise max_goal_rounds or the budget before resuming')
    expect(lastSnapshot(host.entries)).toMatchObject({ roundsStarted: 1, phase: 'blocked' })

    await s.prompt('/goal rounds 2')
    await promptIdle(s, '/goal resume')
    expect(lastSnapshot(host.entries)).toMatchObject({ roundsStarted: 2, lastStop: { code: 'round_limit' } })
  })

  it('a token budget ends the goal after one wrap-up round once crossed', async () => {
    const { session: s, host } = await goalSession([working], goalPort({ defaults: { budget: { tokens: 20 } } }))
    await promptIdle(s, '/goal Keep working')

    expect(rounds(host.entries).map((round) => round.kind)).toEqual(['work', 'work', 'wrap-up'])
    // Each reply: 10 + 2 cached input and 5 output tokens.
    expect(lastSnapshot(host.entries)).toMatchObject({
      phase: 'blocked',
      tokensUsed: 51,
      lastStop: { code: 'budget_exhausted' }
    })
  })

  it('a usd budget uses the price Pi computed from the model spec', async () => {
    const { session: s, host } = await goalSession([working], goalPort({ defaults: { budget: { usd: 0.00003 } } }))
    await promptIdle(s, '/goal Keep working')

    expect(rounds(host.entries).map((round) => round.kind)).toEqual(['work', 'work', 'wrap-up'])
    // MODEL prices input at $1, cached input at $0.1 and output at $2 per million tokens: $0.0000202 a reply.
    expect(lastSnapshot(host.entries)!.costUsed).toBeCloseTo(0.0000606, 12)
  })

  // Breaks when the budget check needs both limits crossed, or reads a usd budget a model without pricing can never reach.
  it('a model without pricing is held to its token budget alone', async () => {
    const unpriced = { ...MODEL, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }
    const { session: s, host } = await goalSession(
      [working],
      goalPort({ defaults: { budget: { usd: 0.00003, tokens: 40 } } }),
      { model: unpriced }
    )
    await promptIdle(s, '/goal Keep working')

    // 17 tokens a reply cross 40 after round 3.
    expect(rounds(host.entries).map((round) => round.kind)).toEqual(['work', 'work', 'work', 'wrap-up'])
    expect(lastSnapshot(host.entries)).toMatchObject({ costUsed: 0, lastStop: { code: 'budget_exhausted' } })
  })

  it('the model can set a cap below the default but not above the ceiling', async () => {
    const { session: s, host } = await goalSession(
      [
        () => [
          toolCall('c1', 'create_goal', { objective: 'g', max_goal_rounds: 5000 }),
          toolCall('c2', 'create_goal', { objective: 'g', max_goal_rounds: 2 }),
          finish('tool-calls')
        ],
        working
      ],
      goalPort({ defaults: { maxGoalRoundsCeiling: 1000 } })
    )
    await s.prompt('go')
    const [tooHigh, accepted] = toolResults(s)
    expect(tooHigh.isError).toBe(true)
    expect(textOf(tooHigh)).toMatch(/between 1 and 1000/)
    expect(accepted.isError).toBe(false)
    expect(lastSnapshot(host.entries)).toMatchObject({
      maxGoalRounds: 2,
      roundsStarted: 2,
      lastStop: { code: 'round_limit' }
    })
  })
})
```

| 用例 | 破坏什么时失败 |
|---|---|
| runs the last allowed round as a wrap-up, then blocks with round_limit | 第 N 轮不是 wrap-up、多跑或少跑一轮、停止码错 |
| after round_limit, resume is refused until the cap is raised… | 触顶后 `resume` 照样开轮；调高上限后无路可走（`editGoal` 不恢复，或 `resume` 不开轮） |
| a token budget ends the goal after one wrap-up round once crossed | 预算判断看不到本轮用量（`decide` 读 `runtime.goal` 而不是 `projected`）；不计 cacheRead；不收尾 |
| a usd budget uses the price Pi computed from the model spec | 不计 `usage.cost.total` |
| a model without pricing is held to its token budget alone | 预算要求 token 和金额同时越过才算；或把无定价模型的 0 当成越过 |
| the model can set a cap below the default but not above the ceiling | 越过绝对上限仍被接受；模型给的较小上限没生效（D3） |

- [ ] **Step 5: 跑测试**

Run: `pnpm exec vitest run --project agent-runtime packages/agent-runtime-pi/tests/goalStops.test.ts`
Expected: PASS。这些用例守的是任务 5 的 `decide()` / `reserve()` 和本任务的 `editGoal`，此时应当已经通过；它们的价值在于以后改动这几处时会失败（变异检查已验证 wrap-up 判断、`projected` 和 `budgetExceeded` 的或关系）。若失败，只修 `decide()` / `reserve()`，不要改测试里的轮数或预算。

- [ ] **Step 6: 格式、lint、提交**

```bash
pnpm exec oxfmt --write packages/agent-runtime-pi/tests/goalStops.test.ts
pnpm exec oxlint --deny-warnings packages/agent-runtime-pi/tests/goalStops.test.ts
pnpm exec eslint packages/agent-runtime-pi/tests/goalStops.test.ts
pnpm --filter @cherrystudio/agent-runtime typecheck
git add packages/agent-runtime-pi/tests/goalStops.test.ts
git -c core.hooksPath=/dev/null commit -S --signoff -m "test(agent-runtime): cover goal round caps and budgets"
git cat-file commit HEAD | grep -E '^gpgsig|Signed-off-by'
```

---

### Task 7: 无进展检测

**Files:**
- Modify: `packages/agent-runtime-pi/src/goalExtension.ts`
- Test: `packages/agent-runtime-pi/tests/goalStops.test.ts`

**Interfaces:**
- Consumes：`toolCallKey`（任务 3）；任务 5 的 `runtime.repeat`（在 `admit()` 里清零）、`runtime.stopRequest`、`runtime.round`、`closeRound()` / `reserve()` 里的无进展计数和 hint。
- Produces：`tool_call` 处理器（轮内重复：第 3 次起拦截并提示，第 5 次记停止请求并结束本批）；`turn_end` 里被截断的回复不更新本轮文字（spec §7.2）。

轮级的无进展计数、hint 轮和 `no_progress` 停止已在任务 5（它们是 `decide()` 第 9、10 条的一部分），本任务的前两条用例守它们，会直接通过；后两条守本任务的代码。

- [ ] **Step 1: 写失败的测试**

`tests/goalStops.test.ts` 顶部的 import 换成：

```ts
import { Type } from '@earendil-works/pi-ai'
import { defineTool } from '@earendil-works/pi-coding-agent'
import { describe, expect, it } from 'vitest'

import {
  goalPort,
  goalSession,
  lastSnapshot,
  notices,
  promptIdle,
  rounds,
  roundStart,
  say,
  toolCall,
  working
} from './goalSupport'
import { finish, MODEL, textParts } from './support'
import { textOf, toolResults } from './toolResults'
```

文件末尾追加。脚本按 `roundStart(prompt)` 区分"一轮的第一次请求"和"工具结果之后的请求"（`goalModel` 只重复最后一个脚本，S7.1），调用 id 带上调用序号（Pi 按 id 配对结果）：

```ts
const readTool = defineTool({
  name: 'read',
  label: 'Read',
  description: 'Reads a file',
  parameters: Type.Object({ path: Type.String() }),
  async execute(_id, params) {
    return { content: [{ type: 'text', text: `contents of ${params.path}` }], details: undefined }
  }
})
const echoTool = defineTool({
  name: 'echo',
  label: 'Echo',
  description: 'Returns its input',
  parameters: Type.Object({ value: Type.String() }),
  async execute(_id, params) {
    return { content: [{ type: 'text', text: params.value }], details: undefined }
  }
})

describe('goal no-progress detection', () => {
  // Breaks when a read counts as progress: the goal would run to its cap.
  it('hints after two rounds without progress and stops after the third when every round only reads', async () => {
    const {
      session: s,
      host,
      calls
    } = await goalSession(
      [
        (prompt, call) =>
          roundStart(prompt) === undefined
            ? say('I read the file.')
            : [toolCall(`r${call}`, 'read', { path: 'a.md' }), finish('tool-calls')]
      ],
      goalPort({ defaults: { maxGoalRounds: 10 } }),
      { tools: [readTool] }
    )
    await promptIdle(s, '/goal Keep working')

    // Round 1's reply is new; rounds 2-4 repeat it.
    expect(rounds(host.entries).map((round) => round.kind)).toEqual(['work', 'work', 'work', 'hint'])
    const hint = calls.find((call) => roundStart(call.prompt) === 4)!
    expect(JSON.stringify(hint.prompt.at(-1))).toContain('The previous 2 rounds made no observable progress')
    expect(lastSnapshot(host.entries)).toMatchObject({
      phase: 'blocked',
      roundsStarted: 4,
      progressRounds: 1,
      lastStop: { code: 'no_progress' }
    })
  })

  // Breaks when a successful echo does not count, or a progressing round does not clear the count.
  it('a round with a successful non-read call clears the count', async () => {
    const { session: s, host } = await goalSession(
      [
        (prompt, call) =>
          (roundStart(prompt) ?? 1) % 3 === 0
            ? [toolCall(`e${call}`, 'echo', { value: 'x' }), finish('tool-calls')]
            : say('nothing new')
      ],
      goalPort({ defaults: { maxGoalRounds: 7 } }),
      { tools: [echoTool] }
    )
    await promptIdle(s, '/goal Keep working')

    // Rounds 3 and 6 echo; rounds 4 and 5 make none, so round 6 is a hint.
    expect(rounds(host.entries).map((round) => round.kind)).toEqual([
      'work',
      'work',
      'work',
      'work',
      'work',
      'hint',
      'wrap-up'
    ])
    expect(lastSnapshot(host.entries)).toMatchObject({ progressRounds: 3, lastStop: { code: 'round_limit' } })
  })

  // Breaks when a reply cut off by the output limit counts as progress (spec §7.2): its text changes every round.
  it('a reply cut off by the output limit is not progress', async () => {
    const { session: s, host } = await goalSession(
      [(_prompt, call) => [...textParts('t', `part ${call}`), finish('length')]],
      goalPort({ defaults: { maxGoalRounds: 10 } })
    )
    await promptIdle(s, '/goal Keep working')

    expect(rounds(host.entries).map((round) => round.kind)).toEqual(['work', 'work', 'hint'])
    expect(lastSnapshot(host.entries)).toMatchObject({ progressRounds: 0, lastStop: { code: 'no_progress' } })
  })

  // Breaks when the repeat count restarts every turn instead of every round: no call is ever blocked.
  it('blocks the third identical call in a round with a hint and ends the goal after the fifth', async () => {
    const {
      session: s,
      host,
      calls
    } = await goalSession(
      // The reply after call 8 keeps a broken implementation from reading forever.
      [
        (_prompt, call) =>
          call <= 8 ? [toolCall(`r${call}`, 'read', { path: 'same.md' }), finish('tool-calls')] : say('giving up')
      ],
      goalPort({ defaults: { maxGoalRounds: 10 } }),
      { tools: [readTool] }
    )
    await promptIdle(s, '/goal Keep working')

    const reads = toolResults(s).filter((result) => result.toolName === 'read')
    expect(reads.map((result) => result.isError)).toEqual([false, false, true, true, true])
    expect(textOf(reads[2])).toMatch(/already been executed in this round/)
    expect(calls).toHaveLength(5)
    expect(lastSnapshot(host.entries)).toMatchObject({
      roundsStarted: 1,
      lastStop: { code: 'no_progress', message: 'the same read call was repeated 5 times' }
    })
  })
})
```

| 用例 | 破坏什么时失败 |
|---|---|
| hints after two rounds without progress and stops after the third when every round only reads | `read` 算进展（跑到上限）；hint 不在计数为 2 时发出；`previousText` 按 turn 而不是按轮更新（P3：只调工具的 turn 会把"上一轮的文字"清空，每轮都算进展） |
| a round with a successful non-read call clears the count | 成功的 `echo` 不算进展（第 4 轮就 `no_progress`）；有进展的轮不清零计数 |
| a reply cut off by the output limit is not progress | 截断的回复按文字变化算进展（每轮文字都不同，会跑到上限） |
| blocks the third identical call in a round with a hint and ends the goal after the fifth | 重复计数每个 turn 清零（P2：永远拦不住；第 8 次之后的回复让坏实现停下而不是死循环） |

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run --project agent-runtime packages/agent-runtime-pi/tests/goalStops.test.ts -t "no-progress"`
Expected: 前两条 PASS（守任务 5）；"cut off by the output limit" FAIL（`no_progress` 没出现，跑到第 10 轮）；"third identical call" FAIL（`read` 结果全是成功，调用不止 5 次）。

- [ ] **Step 3: 实现**

1. `goalState` 的 import 按字母序加 `toolCallKey`（在 `tailRound` 之后）。
2. `STOP_AFTER_ROUNDS` 之后加：

```ts
/** Identical calls in one round before they are blocked, and before the goal stops (spec §7.2). */
const BLOCK_REPEAT_AT = 3
const STOP_REPEAT_AT = 5
```

3. `pi.on('message_end', …)` 之后加：

```ts
    pi.on('tool_call', (event) => {
      if (!runtime.goal || !runtime.inGoalRound || event.parentToolCallId !== undefined) return undefined
      const key = toolCallKey(event.toolName, event.input)
      const count = runtime.repeat.key === key ? runtime.repeat.count + 1 : 1
      runtime.repeat = { key, count }
      if (count < BLOCK_REPEAT_AT) return undefined
      if (count >= STOP_REPEAT_AT)
        runtime.stopRequest = {
          code: 'no_progress',
          message: `the same ${event.toolName} call was repeated ${count} times`
        }
      return {
        block: true,
        reason:
          'The same call has already been executed in this round and its result will not change; change approach or report the concrete blocker.',
        terminate: count >= STOP_REPEAT_AT
      }
    })
```

4. `turn_end` 处理器最后两行换成：

```ts
      const reply = assistantText(event.message)
      // A reply cut off by the output limit shows nothing about progress (spec §7.2).
      if (reply && event.message.stopReason !== 'length') runtime.round.text = reply
```

截断回复里的工具调用 Pi 已经全部判失败（`isError`），`isProgressResult` 不会把它们算进展，所以只需要管文字。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run --project agent-runtime packages/agent-runtime-pi/tests/goalStops.test.ts packages/agent-runtime-pi/tests/goal.test.ts`
Expected: PASS

- [ ] **Step 5: 格式、lint、提交**

```bash
pnpm exec oxfmt --write packages/agent-runtime-pi/src/goalExtension.ts packages/agent-runtime-pi/tests/goalStops.test.ts
pnpm exec oxlint --deny-warnings packages/agent-runtime-pi/src/goalExtension.ts packages/agent-runtime-pi/tests/goalStops.test.ts
pnpm exec eslint packages/agent-runtime-pi/src/goalExtension.ts packages/agent-runtime-pi/tests/goalStops.test.ts
pnpm --filter @cherrystudio/agent-runtime typecheck
git add packages/agent-runtime-pi/src/goalExtension.ts packages/agent-runtime-pi/tests/goalStops.test.ts
git -c core.hooksPath=/dev/null commit -S --signoff -m "feat(agent-runtime): stop goals that make no progress"
git cat-file commit HEAD | grep -E '^gpgsig|Signed-off-by'
```

---

### Task 8: 需要人、错误、中止、后台子代理

**Files:**
- Modify: `packages/agent-runtime-pi/src/goalState.ts`（`GoalStopCode` 改名）
- Modify: `packages/agent-runtime-pi/src/goalExtension.ts`
- Modify: `packages/agent-runtime-pi/tests/goalState.test.ts`（引用旧停止码的一行）
- Test: `packages/agent-runtime-pi/tests/goalStops.test.ts`

**Interfaces:**
- Consumes：`port.onApproval`、`port.hasRunningSubagents`、L3 的 `createAskUserExtension` / `ASK_USER_TOOL_NAME`（`src/askUserExtension.ts`）与 `AskUserQuestionDetails.outcome`（任务 1）、`runtime.stopRequest`、任务 5 的 `decide()` 和 `agent_settled` 处理器。
- Produces：审批订阅（`session_start` 订阅、`session_shutdown` 退订）；`turn_end` 里的 AskUserQuestion 检查；`decide()` 的 spec §6.2 第 8 条；`agent_settled` 上的中止（Pi 行为第 7 条）。

**Notes：**

- 防御性地读 `details?.outcome`（ledger：旧会话和抛错的调用没有 `outcome`）。
- 本任务是第一个读 `GoalPort` 可选成员的任务，先按 L4 的命名约定改名（Step 1），再加 `waiting_subagents`。前台子代理在自己的工具调用里跑完，所以 `hasRunningSubagents` 在 L6 之前没有宿主接线，这里只按端口测试；`onApproval` 由宿主接入 PR 接到 `ToolApprovalRegistry`。
- 审批被拒不碰 `runtime.blocked`（spec §7.3：它不是模型报的阻碍）；它在本轮结束时直接停，不进 blocked 门槛。
- `/goal pause` 在流式输出中中止本轮的用例已在任务 5（"pausing an active goal stops its round…"），这里只测宿主的 `session.abort()`。

- [ ] **Step 1: 改名：`hasRunningChildren` → `hasRunningSubagents`，`waiting_children` → `waiting_subagents`**

`src/goalState.ts` 的 `GoalStopCode` 里把 `| 'waiting_children'` 换成 `| 'waiting_subagents'`。

`src/goalExtension.ts` 的 `GoalPort` 里两个可选成员换成：

```ts
  /** Wired by the host integration (its ToolApprovalRegistry): approval events of this session's tool calls. */
  onApproval?(listener: (event: GoalApprovalEvent) => void): () => void
  /** L6: background subagents of this session still running; foreground subagents finish inside their call. */
  hasRunningSubagents?(): boolean
```

`tests/goalState.test.ts` 的 "maps every stop code to the phase the spec assigns" 里，`'waiting_children'` 换成 `'waiting_subagents'`。这个 `as const` 列表守的是旧名不能残留：漏改测试时 `phaseForStop('waiting_children')` 不再通过类型检查；漏改 `GoalStopCode` 时 `'waiting_subagents'` 不通过。

Run: `grep -rn 'hasRunningChildren\|waiting_children' packages/agent-runtime-pi/src packages/agent-runtime-pi/tests`
Expected: 无输出。

```bash
pnpm exec vitest run --project agent-runtime packages/agent-runtime-pi/tests/goalState.test.ts
pnpm --filter @cherrystudio/agent-runtime typecheck
pnpm exec oxfmt --write packages/agent-runtime-pi/src/goalState.ts packages/agent-runtime-pi/src/goalExtension.ts packages/agent-runtime-pi/tests/goalState.test.ts
pnpm exec oxlint --deny-warnings packages/agent-runtime-pi/src/goalState.ts packages/agent-runtime-pi/src/goalExtension.ts packages/agent-runtime-pi/tests/goalState.test.ts
git add packages/agent-runtime-pi/src/goalState.ts packages/agent-runtime-pi/src/goalExtension.ts packages/agent-runtime-pi/tests/goalState.test.ts
git -c core.hooksPath=/dev/null commit -S --signoff -m "refactor(agent-runtime): name the goal's subagent hook and stop code after subagents"
git cat-file commit HEAD | grep -E '^gpgsig|Signed-off-by'
```

- [ ] **Step 2: 写失败的测试**

`tests/goalStops.test.ts` 顶部的 import 换成：

```ts
import type { LanguageModelV3Prompt } from '@ai-sdk/provider'
import { Type } from '@earendil-works/pi-ai'
import { defineTool } from '@earendil-works/pi-coding-agent'
import { describe, expect, it } from 'vitest'

import { createAskUserExtension, type GoalApprovalEvent } from '../src'
import {
  goalPort,
  goalSession,
  heldGoalSession,
  lastSnapshot,
  notices,
  promptIdle,
  rounds,
  roundStart,
  say,
  toolCall,
  working
} from './goalSupport'
import { finish, MODEL, textParts } from './support'
import { textOf, toolResults } from './toolResults'
```

文件末尾追加。两种审批事件共用一个端口和工具工厂，AskUserQuestion 的输入只写一次（D7）：

```ts
/** A port listening for approval events and a tool that reports `kind` for its own call, as the host's approval layer would. */
function approvals(kind: GoalApprovalEvent['kind']) {
  let listener: ((event: GoalApprovalEvent) => void) | undefined
  const port = goalPort({
    onApproval: (next) => {
      listener = next
      return () => (listener = undefined)
    }
  })
  const tool = defineTool({
    name: 'risky',
    label: 'Risky',
    description: 'Needs approval',
    parameters: Type.Object({}),
    async execute(id) {
      listener?.({ kind, toolCallId: id })
      return { content: [{ type: 'text', text: `approval ${kind}` }], details: undefined, isError: true }
    }
  })
  return { port, tool }
}

/** Every round asks one question, then replies. */
const askEachRound = [
  (prompt: LanguageModelV3Prompt, call: number) =>
    roundStart(prompt) === undefined
      ? say(`reply ${call}`)
      : [
          toolCall(`q${call}`, 'AskUserQuestion', {
            questions: [
              {
                question: 'Which?',
                header: 'Pick',
                options: [
                  { label: 'A', description: 'a' },
                  { label: 'B', description: 'b' }
                ]
              }
            ]
          }),
          finish('tool-calls')
        ]
]

describe('goal stops for people, errors and aborts', () => {
  it.each([
    ['denied', 'approval_denied'],
    ['unavailable', 'awaiting_approval']
  ] as const)('an approval %s in a goal round blocks the goal with %s when that round ends', async (kind, code) => {
    const { port, tool } = approvals(kind)
    const {
      session: s,
      host,
      calls
    } = await goalSession(
      [
        (prompt, call) =>
          roundStart(prompt) === undefined
            ? say(`reply ${call}`)
            : [toolCall(`k${call}`, 'risky', {}), finish('tool-calls')]
      ],
      port,
      { tools: [tool] }
    )
    await promptIdle(s, '/goal Keep working')

    expect(calls).toHaveLength(2)
    expect(lastSnapshot(host.entries)).toMatchObject({ phase: 'blocked', roundsStarted: 1, lastStop: { code } })
  })

  it('a question the user dismisses in a goal round blocks the goal with needs_user_input', async () => {
    const { session: s, host } = await goalSession(askEachRound, goalPort(), {
      extensionFactories: [createAskUserExtension({ ask: async () => ({ status: 'declined' }) })]
    })
    await promptIdle(s, '/goal Keep working')
    expect(lastSnapshot(host.entries)).toMatchObject({ roundsStarted: 1, lastStop: { code: 'needs_user_input' } })
  })

  it('a question nobody can answer does not stop the goal', async () => {
    const { session: s, host } = await goalSession(askEachRound, goalPort({ defaults: { maxGoalRounds: 3 } }), {
      extensionFactories: [createAskUserExtension({ ask: async () => ({ status: 'unavailable' }) })]
    })
    await promptIdle(s, '/goal Keep working')
    expect(lastSnapshot(host.entries)).toMatchObject({ roundsStarted: 3, lastStop: { code: 'round_limit' } })
  })

  it('a failed model request blocks the goal with provider_error and the provider message', async () => {
    const { session: s, host } = await goalSession([
      (_prompt, call) => (call === 2 ? [{ type: 'error', error: new Error('upstream exploded') }] : say('one'))
    ])
    await promptIdle(s, '/goal Keep working')
    expect(lastSnapshot(host.entries)).toMatchObject({
      phase: 'blocked',
      roundsStarted: 2,
      lastStop: { code: 'provider_error', message: 'upstream exploded' }
    })
  })

  // Breaks when the abort is handled only at agent_before_settle, which Pi skips after session.abort():
  // the goal would stay armed, and the next message's settle would start round 2.
  it('aborting the run pauses the goal, and the next message does not continue it', async () => {
    const { session: s, host, held } = await heldGoalSession()
    await s.prompt('/goal Keep working')
    await held.started(1)
    await s.abort()
    expect(lastSnapshot(host.entries)).toMatchObject({
      phase: 'paused',
      roundsStarted: 1,
      lastStop: { code: 'aborted' }
    })

    held.release()
    await s.prompt('hello')
    expect(rounds(host.entries)).toHaveLength(1)
    expect(held.calls.length).toBe(2)
  })

  // Breaks when decide() never asks the port: the goal would open round 2 while subagents still run.
  it('a host reporting running subagents ends the goal after the round with waiting_subagents', async () => {
    const { session: s, host, calls } = await goalSession([working], goalPort({ hasRunningSubagents: () => true }))
    await promptIdle(s, '/goal Keep working')
    expect(lastSnapshot(host.entries)).toMatchObject({
      phase: 'blocked',
      roundsStarted: 1,
      lastStop: { code: 'waiting_subagents' }
    })
    expect(calls).toHaveLength(1)
  })
})
```

| 用例 | 破坏什么时失败 |
|---|---|
| an approval denied / unavailable in a goal round blocks the goal with approval_denied / awaiting_approval when that round ends | 审批事件被忽略：goal 进入第 2 轮；或被拒当成"再试一次"（spec §13）。`awaiting_approval` 的 phase 是 `blocked`（D9） |
| a question the user dismisses in a goal round blocks the goal with needs_user_input | 不看 `outcome === 'declined'` |
| a question nobody can answer does not stop the goal | 把 `unavailable` 也当成需要人 |
| a failed model request blocks the goal with provider_error and the provider message | 错误时继续或丢了 `errorMessage`（`decide()` 第 2 条，任务 5） |
| aborting the run pauses the goal, and the next message does not continue it | 只在 `agent_before_settle` 处理中止：Pi 在 `session.abort()` 后跳过它，goal 保持武装，下一条消息的 settle 会开第 2 轮 |
| a host reporting running subagents ends the goal after the round with waiting_subagents | `decide()` 不问端口，第 2 轮照开 |

- [ ] **Step 3: 跑测试确认失败**

Run: `pnpm exec vitest run --project agent-runtime packages/agent-runtime-pi/tests/goalStops.test.ts -t "people, errors"`
Expected: 两条审批、`needs_user_input`、中止、`waiting_subagents` FAIL；"nobody can answer" 和 `provider_error` PASS（守任务 5）。

- [ ] **Step 4: 实现**

1. import 区加 `import { ASK_USER_TOOL_NAME } from './askUserExtension'`（在 `./goalState` 之前）。
2. `pi.on('session_start', …)` 换成下面这段（订阅审批，`session_shutdown` 退订）：

```ts
    let unsubscribeApproval: (() => void) | undefined
    pi.on('session_start', (_event, ctx) => {
      runtime.goal = currentGoal(ctx.sessionManager.getBranch())
      runtime.armed = false
      runtime.inGoalRound = false
      unsubscribeApproval?.()
      unsubscribeApproval = port.onApproval?.((event) => {
        if (!runtime.goal || !runtime.inGoalRound) return
        if (event.kind === 'denied')
          runtime.stopRequest = { code: 'approval_denied', message: `tool call ${event.toolCallId} was denied` }
        if (event.kind === 'unavailable')
          runtime.stopRequest = {
            code: 'awaiting_approval',
            message: `tool call ${event.toolCallId} needs approval and nobody can give it`
          }
      })
    })
    pi.on('session_shutdown', () => {
      unsubscribeApproval?.()
      unsubscribeApproval = undefined
    })
```

3. `turn_end` 的 `for (const result of event.toolResults)` 循环里，`isProgressResult` 那行之后加：

```ts
        // Stored sessions and thrown calls carry no `outcome`.
        if (
          result.toolName === ASK_USER_TOOL_NAME &&
          (result.details as { outcome?: string } | undefined)?.outcome === 'declined'
        )
          runtime.stopRequest = { code: 'needs_user_input', message: 'the user dismissed the question' }
```

4. `decide()` 里、`pendingMessages` 让路之后、无进展判断之前插入 spec §6.2 第 8 条：

```ts
      if (port.hasRunningSubagents?.() === true) {
        stop('waiting_subagents')
        return undefined
      }
```

5. `agent_settled` 处理器换成：

```ts
    pi.on('agent_settled', (event) => {
      const rejected = runtime.reservation !== undefined
      runtime.reservation = undefined
      runtime.inGoalRound = false
      if (runtime.goal?.phase !== 'active') return
      // Pi skips agent_before_settle after session.abort(); the abort surfaces only here.
      if (event.aborted) stop('aborted')
      else if (rejected) stop('continuation_rejected')
    })
```

中止压过 `continuation_rejected`：在 `agent_before_settle` 期间中止时，我们的轮消息可能已提交、预约还在，这时记 `aborted`。

- [ ] **Step 5: 跑测试确认通过**

Run: `pnpm exec vitest run --project agent-runtime packages/agent-runtime-pi/tests/goalStops.test.ts packages/agent-runtime-pi/tests/goal.test.ts packages/agent-runtime-pi/tests/goalState.test.ts`
Expected: PASS

- [ ] **Step 6: 格式、lint、提交**

```bash
pnpm exec oxfmt --write packages/agent-runtime-pi/src/goalExtension.ts packages/agent-runtime-pi/tests/goalStops.test.ts
pnpm exec oxlint --deny-warnings packages/agent-runtime-pi/src/goalExtension.ts packages/agent-runtime-pi/tests/goalStops.test.ts
pnpm exec eslint packages/agent-runtime-pi/src/goalExtension.ts packages/agent-runtime-pi/tests/goalStops.test.ts
pnpm --filter @cherrystudio/agent-runtime typecheck
git add packages/agent-runtime-pi/src/goalExtension.ts packages/agent-runtime-pi/tests/goalStops.test.ts
git -c core.hooksPath=/dev/null commit -S --signoff -m "feat(agent-runtime): stop goals when a person is needed, on errors and on abort"
git cat-file commit HEAD | grep -E '^gpgsig|Signed-off-by'
```

---

### Task 9: 模型自报：complete 与 blocked

**Files:**
- Modify: `packages/agent-runtime-pi/src/goalExtension.ts`
- Test: `packages/agent-runtime-pi/tests/goalStops.test.ts`

**Interfaces:**
- Consumes：`port.verify`、`port.defaults.blockedAfter`、任务 5 的 `runtime.blocked`（人类回合开始时已清零）和 `roundProgressed()`；Pi 导出的自由函数 `buildSessionContext(entries, leafId)` 与 `convertToLlm`（`ReadonlySessionManager` 没有 `buildSessionContext` 方法，包里 `transcriptTap.ts` 也这样用，Q11）；`modelMessages.ts` 的 `toModelMessages`。
- Produces：

```ts
const conversation: (ctx: ExtensionContext) => ConversationModelMessage[]
const completeGoal: (goal: GoalSnapshot, evidence: string | undefined, signal: AbortSignal | undefined, ctx: ExtensionContext) => Promise<AgentToolResult<unknown>>
const blockGoal: (goal: GoalSnapshot, reason: string | undefined, ctx: ExtensionContext) => AgentToolResult<unknown>
const commitEdit: (next: GoalSnapshot) => void // commit() 之后把 blocked 计数清零（spec §7.5：用户编辑目标）
```

两个函数替换任务 4 的占位，新增的 `ctx` 参数来自 `update_goal` 的 `execute(_id, params, signal, _onUpdate, ctx)`，调用处一起改（X4、Q10）。

**Notes（ledger 与 spec 7be08c2c58）：**

- C7：`await port.verify.verify(...)` 之后用 `requireRevision(goal.id, goal.revision)` 重新核对；等待期间落下的 `/goal edit`、`pause`、`clear` 让这次完成以 stale 错误结束（S9.1）。pause 拒绝 `complete` 目标已在任务 4（R5），`complete` 现在可达，加一条用例守它（S9.2）。
- 核验端口收到的是当前 session 上下文经 `convertToLlm` + `toModelMessages` 的结果（与压缩摘要器的输入形状相同），不再截取最后 N 条，所以不需要 `VERIFY_MESSAGES`（Q10）。
- `blocked`：人类回合里直接接受；goal 轮里按轮号数连续上报的轮，`blockedAfter`（默认 3）轮才接受；人类回合开始（任务 5 的 `startHumanTurn`）和用户编辑目标（本任务的 `commitEdit`）清零；不按 revision 清零（Q12、S9.3）。不比较 `blocked_reason` 是否相同：提示词要求模型只在同一条件持续时上报，运行时只数轮。
- 成功的工具结果 `isError` 是 `false`，不是 `undefined`（S9.5）。

- [ ] **Step 1: 写失败的测试**

`tests/goalStops.test.ts` 的 import 再加三个名字：`@earendil-works/pi-coding-agent` 那行改成 `import { type AgentSession, defineTool } from '@earendil-works/pi-coding-agent'`，`'../src'` 那行加 `type GoalSnapshot`，`./goalSupport` 加 `readGoal`。最终的 import 段：

```ts
import type { LanguageModelV3Prompt } from '@ai-sdk/provider'
import { Type } from '@earendil-works/pi-ai'
import { type AgentSession, defineTool } from '@earendil-works/pi-coding-agent'
import { describe, expect, it } from 'vitest'

import { createAskUserExtension, type GoalApprovalEvent, type GoalSnapshot } from '../src'
import {
  goalPort,
  goalSession,
  heldGoalSession,
  lastSnapshot,
  notices,
  promptIdle,
  readGoal,
  rounds,
  roundStart,
  say,
  toolCall,
  working
} from './goalSupport'
import { finish, MODEL, textParts } from './support'
import { textOf, toolResults } from './toolResults'
```

文件末尾追加：

```ts
/** Each round reads the goal, sends update_goal with `update(goal)` when it returns arguments, then replies. */
function eachRound(update: (goal: GoalSnapshot) => Record<string, unknown> | undefined) {
  return (prompt: LanguageModelV3Prompt, call: number) => {
    if (roundStart(prompt) !== undefined) return [toolCall(`g${call}`, 'get_goal', {}), finish('tool-calls')]
    const last = prompt.at(-1)
    const afterGetGoal =
      last?.role === 'tool' && last.content.some((part) => part.type === 'tool-result' && part.toolName === 'get_goal')
    const { goal } = readGoal(prompt)
    const args = afterGetGoal && goal ? update(goal) : undefined
    return args
      ? [
          toolCall(`u${call}`, 'update_goal', { goal_id: goal!.id, revision: goal!.revision, ...args }),
          finish('tool-calls')
        ]
      : say(`reply ${call}`)
  }
}
const updates = (s: AgentSession) => toolResults(s).filter((result) => result.toolName === 'update_goal')

describe('goal self-reports', () => {
  // Breaks when the fallback skips a check: round 1 would complete with no progress, round 2 without evidence.
  it('without a verifier, complete needs a round that progressed and evidence', async () => {
    const { session: s, host } = await goalSession([
      eachRound((goal) => ({ action: 'complete', evidence: goal.roundsStarted === 2 ? '' : 'the docs gate passes' }))
    ])
    await promptIdle(s, '/goal Keep working')

    const attempts = updates(s)
    expect(attempts.map((result) => result.isError)).toEqual([true, true, false])
    expect(textOf(attempts[0])).toMatch(/No round of this goal changed anything yet/)
    expect(textOf(attempts[1])).toMatch(/complete needs evidence/)
    expect(lastSnapshot(host.entries)).toMatchObject({ phase: 'complete', lastStop: { code: 'complete' } })
    expect(rounds(host.entries)).toHaveLength(3)
  })

  it('a verifier that says not_met keeps the goal open with its reason; impossible blocks it', async () => {
    const verdicts: Array<'not_met' | 'impossible'> = ['not_met', 'impossible']
    const seen: string[] = []
    const port = goalPort({
      verify: {
        verify: async ({ messages }) => {
          seen.push(JSON.stringify(messages))
          return { verdict: verdicts.shift()!, reason: 'tests are red' }
        }
      }
    })
    const { session: s, host } = await goalSession([eachRound(() => ({ action: 'complete', evidence: 'done' }))], port)
    await promptIdle(s, '/goal Keep working')

    const [notMet, impossible] = updates(s)
    expect(notMet.isError).toBe(true)
    expect(textOf(notMet)).toBe('Not complete yet: tests are red')
    expect(impossible.isError).toBe(false)
    expect(lastSnapshot(host.entries)).toMatchObject({
      phase: 'blocked',
      roundsStarted: 2,
      lastStop: { code: 'model_blocked', message: 'tests are red' }
    })
    // The verifier gets the session's conversation, round prompt included.
    expect(seen[0]).toContain('<goal_round>')
  })

  it('a verifier that throws does not pass the completion', async () => {
    const port = goalPort({
      defaults: { maxGoalRounds: 1 },
      verify: {
        verify: async () => {
          throw new Error('evaluator offline')
        }
      }
    })
    const { session: s, host } = await goalSession([eachRound(() => ({ action: 'complete', evidence: 'done' }))], port)
    await promptIdle(s, '/goal Keep working')

    const [attempt] = updates(s)
    expect(attempt.isError).toBe(true)
    expect(textOf(attempt)).toContain('evaluator offline')
    expect(lastSnapshot(host.entries)).toMatchObject({ phase: 'blocked', lastStop: { code: 'round_limit' } })
  })

  // Breaks without the revision check after the verifier's await: the goal would complete under an objective nobody verified.
  it('a goal edited while the verifier runs is not completed by that call', async () => {
    const user: { session?: AgentSession } = {}
    let edited = false
    const port = goalPort({
      verify: {
        verify: async () => {
          if (!edited) {
            edited = true
            await user.session!.prompt('/goal edit Ship v2 instead')
          }
          return { verdict: 'met', reason: 'ok' }
        }
      }
    })
    const opened = await goalSession([eachRound(() => ({ action: 'complete', evidence: 'done' }))], port)
    user.session = opened.session
    await promptIdle(opened.session, '/goal Ship v1')

    const [stale, completed] = updates(opened.session)
    expect(stale.isError).toBe(true)
    expect(textOf(stale)).toMatch(/Stale goal reference/)
    expect(completed.isError).toBe(false)
    expect(lastSnapshot(opened.host.entries)).toMatchObject({ objective: 'Ship v2 instead', phase: 'complete' })
  })

  // Breaks when /goal pause treats a complete goal like an open one and reopens it as paused.
  it('/goal pause leaves a complete goal complete', async () => {
    const port = goalPort({ verify: { verify: async () => ({ verdict: 'met', reason: 'ok' }) } })
    const { session: s, host } = await goalSession([eachRound(() => ({ action: 'complete', evidence: 'done' }))], port)
    await promptIdle(s, '/goal Keep working')
    expect(lastSnapshot(host.entries)).toMatchObject({ phase: 'complete' })

    await s.prompt('/goal pause')
    expect(notices(host.entries).at(-1)).toBe('the goal is complete; create a new one')
    expect(lastSnapshot(host.entries)).toMatchObject({ phase: 'complete' })
  })

  // Breaks when the threshold is skipped, or counts reports that are not in consecutive rounds.
  it('blocked is accepted only after three consecutive goal rounds report it', async () => {
    const { session: s, host } = await goalSession(
      [
        eachRound((goal) =>
          goal.roundsStarted === 2 ? undefined : { action: 'blocked', blocked_reason: 'the API key is missing' }
        )
      ],
      goalPort({ defaults: { maxGoalRounds: 10 } })
    )
    await promptIdle(s, '/goal Keep working')

    // Round 2 reports nothing, so round 3 starts the count over.
    const attempts = updates(s)
    expect(attempts.map((result) => result.isError)).toEqual([true, true, true, false])
    expect(textOf(attempts[0])).toBe(
      'Keep trying; if the same condition still blocks you in round 3, report it again (1/3).'
    )
    expect(lastSnapshot(host.entries)).toMatchObject({
      phase: 'blocked',
      roundsStarted: 5,
      lastStop: { code: 'model_blocked', message: 'the API key is missing' }
    })
  })

  // Breaks when a human turn or a user edit does not start the blocked count over (spec §7.5).
  it.each([
    ['a user message', (s: AgentSession) => s.prompt('a question from the user', { streamingBehavior: 'followUp' })],
    ['a /goal edit', (s: AgentSession) => s.prompt('/goal edit Keep working, differently')]
  ])('%s between reports starts the blocked count over', async (_name, interject) => {
    const opened = await goalSession(
      [eachRound(() => ({ action: 'blocked', blocked_reason: 'the API key is missing' }))],
      goalPort({ defaults: { maxGoalRounds: 10 } })
    )
    const { session: s, host } = opened
    let done = false
    s.subscribe((event) => {
      // After round 2's reply and before its settle.
      if (event.type !== 'turn_end' || event.toolResults.length > 0 || done || rounds(host.entries).length !== 2) return
      done = true
      void interject(s)
    })
    await promptIdle(s, '/goal Keep working')

    expect(updates(s).map((result) => result.isError)).toEqual([true, true, true, true, false])
    expect(lastSnapshot(host.entries)).toMatchObject({ roundsStarted: 5, lastStop: { code: 'model_blocked' } })
  })

  // Breaks when the round threshold also applies in a human turn, where a person is there to resume.
  it('in a human turn blocked is accepted at once', async () => {
    const { session: s, host } = await goalSession([
      () => [toolCall('c', 'create_goal', { objective: 'g' }), finish('tool-calls')],
      (prompt) => [
        toolCall('b', 'update_goal', {
          goal_id: readGoal(prompt).goal!.id,
          revision: 1,
          action: 'blocked',
          blocked_reason: 'the API key is missing'
        }),
        finish('tool-calls')
      ],
      () => say('Blocked.')
    ])
    await s.prompt('please do g')

    expect(updates(s).map((result) => result.isError)).toEqual([false])
    expect(lastSnapshot(host.entries)).toMatchObject({
      phase: 'blocked',
      roundsStarted: 0,
      lastStop: { code: 'model_blocked' }
    })
  })
})
```

| 用例 | 破坏什么时失败 |
|---|---|
| without a verifier, complete needs a round that progressed and evidence | 退化检查少一条：第 1 轮在没有任何进展时完成，或第 2 轮没有 evidence 也完成（D4） |
| a verifier that says not_met keeps the goal open with its reason; impossible blocks it | `not_met` 放行、`impossible` 没转成 `model_blocked`；核验端口收不到会话内容 |
| a verifier that throws does not pass the completion | 核验抛错时放行 |
| a goal edited while the verifier runs is not completed by that call | `await` 之后不重新核对 revision（C7、S9.1） |
| /goal pause leaves a complete goal complete | pause 把 `complete` 目标改成 `paused`（R5） |
| blocked is accepted only after three consecutive goal rounds report it | 没有门槛；或数的不是连续轮（第 4 轮就接受） |
| a user message / a /goal edit between reports starts the blocked count over | 人类回合或用户编辑不清零计数（第 3 轮就接受） |
| in a human turn blocked is accepted at once | 人类回合里也套用轮数门槛（S9.3） |

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run --project agent-runtime packages/agent-runtime-pi/tests/goalStops.test.ts -t "self-reports"`
Expected: FAIL。complete 类用例的结果是 `complete is not available yet`，blocked 类用例是 `blocked is not available yet`（任务 4 的占位，S9.4）。

- [ ] **Step 3: 实现**

1. import：`@earendil-works/pi-coding-agent` 那段按字母序加 `buildSessionContext`、`convertToLlm`；`import type { ConversationModelMessage } from './modelMessages'` 换成 `import { type ConversationModelMessage, toModelMessages } from './modelMessages'`。
2. `commit` 之后加：

```ts
    /** Spec §7.5: a user edit starts the blocked count over. */
    const commitEdit = (next: GoalSnapshot) => {
      commit(next)
      runtime.blocked = { round: 0, count: 0 }
    }
```

   编辑目标的四处 `commit(editGoal(…))` 改成 `commitEdit(editGoal(…))`：`update_goal` 的 `edit` 分支，命令的 `edit`、`rounds`、`budget` 分支。
3. `update_goal` 的 `switch` 里两处调用换成：

```ts
          case 'complete':
            return completeGoal(goal, params.evidence, signal, ctx)
          case 'blocked':
            return blockGoal(goal, params.blocked_reason, ctx)
```

4. 任务 4 的两个占位（连同上面的 `// Tasks 5–9 fill these in …` 注释）换成：

```ts
    /** The conversation as the session model would get it, for the host's verifier (spec §9). */
    const conversation = (ctx: ExtensionContext): ConversationModelMessage[] => {
      const { messages } = buildSessionContext(ctx.sessionManager.getEntries(), ctx.sessionManager.getLeafId())
      return toModelMessages(convertToLlm(messages), ctx.model!)
    }
    const completeGoal = async (
      goal: GoalSnapshot,
      evidence: string | undefined,
      signal: AbortSignal | undefined,
      ctx: ExtensionContext
    ) => {
      const claim: { evidence?: string } = hasText(evidence) ? { evidence: evidence.trim() } : {}
      if (port.verify) {
        let verdict: Awaited<ReturnType<GoalVerifier['verify']>>
        try {
          verdict = await port.verify.verify({
            objective: goal.objective,
            claim,
            messages: conversation(ctx),
            signal: signal ?? new AbortController().signal
          })
        } catch (error) {
          throw new GoalError(
            'invalid_action',
            `Completion could not be verified (${error instanceof Error ? error.message : String(error)}); keep working or report a blocker.`
          )
        }
        // A command may have edited, paused or cleared the goal while the verifier ran.
        requireRevision(goal.id, goal.revision)
        if (verdict.verdict === 'not_met') throw new GoalError('invalid_action', `Not complete yet: ${verdict.reason}`)
        if (verdict.verdict === 'impossible') stop('model_blocked', verdict.reason)
        else stop('complete')
        return ok()
      }
      if (!claim.evidence)
        throw new GoalError(
          'invalid_action',
          'complete needs evidence: name each deliverable and what proves it is done.'
        )
      if (goal.progressRounds === 0 && !(runtime.inGoalRound && roundProgressed()))
        throw new GoalError(
          'invalid_action',
          'No round of this goal changed anything yet; do the work before marking it complete.'
        )
      stop('complete')
      return ok()
    }
    const blockGoal = (goal: GoalSnapshot, reason: string | undefined, ctx: ExtensionContext) => {
      if (!hasText(reason))
        throw new GoalError('invalid_action', 'blocked needs blocked_reason: the concrete condition that persisted.')
      // Spec §7.5: in a human turn a person is there to resume; a goal round needs consecutive reports.
      if (!isHumanTurn(ctx.sessionManager.getBranch())) {
        const round = goal.roundsStarted
        if (runtime.blocked.round !== round)
          runtime.blocked = { round, count: runtime.blocked.round === round - 1 ? runtime.blocked.count + 1 : 1 }
        const { count } = runtime.blocked
        const needed = port.defaults.blockedAfter
        if (count < needed)
          throw new GoalError(
            'invalid_action',
            `Keep trying; if the same condition still blocks you in round ${round + needed - count}, report it again (${count}/${needed}).`
          )
      }
      stop('model_blocked', reason.trim())
      return ok()
    }
```

`stop()` 把 `armed` 置 false，`decide()` 第 3 条看到 phase 不是 `active` 就不再续跑，所以 complete / blocked 之后本轮结束即停。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run --project agent-runtime packages/agent-runtime-pi/tests/goalStops.test.ts packages/agent-runtime-pi/tests/goal.test.ts`
Expected: PASS

- [ ] **Step 5: 格式、lint、提交**

```bash
pnpm exec oxfmt --write packages/agent-runtime-pi/src/goalExtension.ts packages/agent-runtime-pi/tests/goalStops.test.ts
pnpm exec oxlint --deny-warnings packages/agent-runtime-pi/src/goalExtension.ts packages/agent-runtime-pi/tests/goalStops.test.ts
pnpm exec eslint packages/agent-runtime-pi/src/goalExtension.ts packages/agent-runtime-pi/tests/goalStops.test.ts
pnpm --filter @cherrystudio/agent-runtime typecheck
git add packages/agent-runtime-pi/src/goalExtension.ts packages/agent-runtime-pi/tests/goalStops.test.ts
git -c core.hooksPath=/dev/null commit -S --signoff -m "feat(agent-runtime): accept goal completion and blocking on the runtime's terms"
git cat-file commit HEAD | grep -E '^gpgsig|Signed-off-by'
```

---

### Task 10: 门控、重建、压缩、子代理里不生效

**Files:**
- Modify: `packages/agent-runtime-pi/src/goalState.ts`（`GoalErrorCode` 加 `in_subagent`）
- Modify: `packages/agent-runtime-pi/src/goalExtension.ts`
- Create: `packages/agent-runtime-pi/tests/goalRebuild.test.ts`

**Interfaces:**
- Consumes：L2 的 `transcript` 选项与 `hostStore`；`port.modelSupportsTools`；L4 的 `isSubagentSession`（包内，`src/subagent.ts`，看 branch 上有没有 `cherry.subagent-origin` 条目；不从 `index.ts` 导出）、`subagents` 选项和 `tests/subagentSupport.ts` 的 `routedModel` / `recordingSubagentPort` / `subagentCall` / `toolCallPart` / `toolResults` / `outputText`；任务 5 的 `crashedTranscript()`、`openGoalSession()`。
- Produces：`unsupported_model` 快照；`Runtime.inSubagent` 和 `requireMainAgent()`（子代理的 session 里三个工具都抛 `GoalError('in_subagent')`，`session_start` 不恢复目标，`agent_before_settle` 不续跑，spec §8.4）。

**Notes：**

- C8：恢复测试用 `crashedTranscript()` 拿到一个 `active` 的目标（原计划用 `confirm-each-round`，目标在重建时已是 `paused`，测不出是否武装，D5），并用 `/goal` 的状态文本看 activation。
- 不支持工具调用的用例同样用崩溃的 transcript（S10.1：原计划的 `paused` 目标不会被标 `unsupported_model`），并检查命令没有注册（D11）。
- 压缩用例用宿主摘要器（`compaction.summarize`），模型调用就只有轮次；`finish(unified, input, output)` 直接给出按提示长度估的输入 token，不复制 `compaction.test.ts` 的 `sizedFinish`（D7）。断言压缩后的那次请求不再含第 1 轮的回复、而它的最后一条消息（本轮提示）仍含目标（D6：原断言在任何情况下都成立）。"模型请求与重建一致"由 L2 的 `transcript.test.ts`（"rebuilds a session that sends the same request as the live one…"，其中包括 `cherry.goal-round` 消息）覆盖，这里不重复。
- `session_start` 在子代理里提前返回，也就不订阅审批、不恢复目标；没有单独的用例（fork 用例守的是工具和续跑，它们由 `requireMainAgent()` 和 `agent_before_settle` 的门控保证）。这个分支让 fork 在被中止时不往自己的 transcript 里写 goal 快照。

- [ ] **Step 1: 写失败的测试**

```ts
// packages/agent-runtime-pi/tests/goalRebuild.test.ts
import { describe, expect, it } from 'vitest'

import { createGoalExtension } from '../src'
import {
  crashedTranscript,
  goalPort,
  goalSession,
  lastSnapshot,
  notices,
  openGoalSession,
  promptIdle,
  readGoal,
  rounds,
  working
} from './goalSupport'
import {
  outputText,
  recordingSubagentPort,
  routedModel,
  subagentCall,
  toolCallPart,
  toolResults
} from './subagentSupport'
import { finish, MODEL, tempDir, textParts } from './support'

describe('goal across sessions', () => {
  // Breaks when session_start restores the goal armed: the first message's settle would start round 2.
  it('a session rebuilt after a crash mid-round restores the goal disarmed, and resume continues it', async () => {
    const cwd = tempDir('cwd')
    const transcript = await crashedTranscript('Keep working', goalPort({ defaults: { maxGoalRounds: 3 } }), cwd)
    const { session: s, host, calls } = await goalSession([working], goalPort(), { cwd, transcript })

    await promptIdle(s, 'hello again')
    expect(calls).toHaveLength(1)
    expect(rounds(host.entries)).toEqual([])
    await s.prompt('/goal')
    expect(notices(host.entries).at(-1)).toBe('Goal: Keep working\nPhase: active · disarmed\nRounds: 1/3 · Tokens: 0')

    await promptIdle(s, '/goal resume')
    // The cap is stored on the goal, so the rebuilt session keeps 3 although its port says 100.
    expect(rounds(host.entries).map((round) => round.round)).toEqual([2, 3])
    expect(lastSnapshot(host.entries)).toMatchObject({ roundsStarted: 3, lastStop: { code: 'round_limit' } })
  })

  // Breaks when a model without tool calling still gets the goal tools or the command, or the goal is left looking runnable.
  it('a model without tool calling gets no goal tools or command, and an active goal is marked unsupported', async () => {
    const cwd = tempDir('cwd')
    const transcript = await crashedTranscript('Keep working', goalPort(), cwd)
    const {
      session: s,
      host,
      calls
    } = await goalSession([working], goalPort({ modelSupportsTools: () => false }), {
      cwd,
      transcript
    })
    await promptIdle(s, '/goal')

    expect(calls[0].tools?.map((tool) => tool.name) ?? []).not.toContain('get_goal')
    // Without the command, `/goal` reaches the model as text.
    expect(JSON.stringify(calls[0].prompt.at(-1))).toContain('/goal')
    expect(notices(host.entries)).toEqual([])
    expect(lastSnapshot(host.entries)).toMatchObject({ phase: 'blocked', lastStop: { code: 'unsupported_model' } })
  })

  // Breaks when a round prompt leans on history for the objective: once compaction folds round 1 the request lacks it.
  it('after compaction folds the first rounds, the next round prompt still carries the objective', async () => {
    const {
      session: s,
      host,
      calls
    } = await goalSession(
      // Pi anchors its context estimate on reported usage, so report a prompt-sized input; ~1.2k tokens of
      // reply per round cross a 9k window with a 2k reserve after a few rounds.
      [
        (prompt, call) => [
          ...textParts('t', `step ${call}: ${'detail '.repeat(600)}`),
          finish('stop', Math.ceil(JSON.stringify(prompt).length / 3.5), 1_200)
        ]
      ],
      goalPort({ defaults: { maxGoalRounds: 8 } }),
      {
        model: { ...MODEL, contextWindow: 9_000 },
        compaction: { reserveTokens: 2_000, keepRecentTokens: 1_000, summarize: async () => 'SUMMARY-MARKER' }
      }
    )
    await promptIdle(s, '/goal Finish the OBJECTIVE-MARKER work')

    expect(host.entries.some((entry) => entry.kind === 'compaction')).toBe(true)
    const afterCompaction = calls.find((call) => JSON.stringify(call.prompt).includes('SUMMARY-MARKER'))!
    expect(JSON.stringify(afterCompaction.prompt)).not.toContain('step 1:')
    expect(JSON.stringify(afterCompaction.prompt.at(-1))).toContain('OBJECTIVE-MARKER')
  })
})

describe('goal inside a subagent', () => {
  // Breaks when the fork treats the goal entries it inherited as its own: get_goal returns the
  // parent's goal, resume arms it, and the fork gets a goal round of its own after its report.
  it('a fork started in a goal round inherits the goal entries but cannot read, resume or continue the goal', async () => {
    const { model, calls } = routedModel((call) => {
      if (call.userText.includes('TASK-FORK')) {
        if (call.lastRole === 'user') return [toolCallPart('fork_get', 'get_goal'), finish('tool-calls')]
        if (toolResults(call).at(-1)?.toolName === 'get_goal') {
          // Copy what get_goal returned, as a model would; a failed get_goal leaves nothing to copy.
          const { goal } = readGoal(call.options.prompt)
          return [
            toolCallPart('fork_resume', 'update_goal', {
              goal_id: goal?.id ?? 'none',
              revision: goal?.revision ?? 0,
              action: 'resume'
            }),
            finish('tool-calls')
          ]
        }
        return [...textParts('r', 'FORK-REPORT'), finish('stop')]
      }
      return call.lastRole === 'user'
        ? [
            subagentCall('call_fork', { description: 'Fork check', prompt: 'TASK-FORK', fork: true }),
            finish('tool-calls')
          ]
        : [...textParts('d', 'The fork reported back.'), finish('stop')]
    })
    const port = goalPort({ defaults: { autonomy: () => 'confirm-each-round' } })
    // A fork must get the parent's extensions (README "Subagents"), so the goal extension loads in it too.
    const subagents = recordingSubagentPort(() => ({ extensionFactories: [createGoalExtension(port)] }))
    const { session: s } = await openGoalSession(model, port, { subagents: subagents.port })
    await promptIdle(s, '/goal Keep working')

    const forkCalls = calls.filter((call) => call.userText.includes('TASK-FORK'))
    // The fork started from the goal round, so the goal was on its branch.
    expect(forkCalls[0].userText).toContain('<goal_round>')
    // get_goal, update_goal, the report: no goal round follows in the fork.
    expect(forkCalls).toHaveLength(3)
    const goalResults = toolResults(forkCalls.at(-1)!).filter((part) => part.toolCallId.startsWith('fork_'))
    expect(goalResults.map((part) => [part.toolName, part.output.type])).toEqual([
      ['get_goal', 'error-text'],
      ['update_goal', 'error-text']
    ])
    for (const part of goalResults) expect(outputText(part.output)).toMatch(/belong to the main agent/)
  })
})
```

| 用例 | 破坏什么时失败 |
|---|---|
| a session rebuilt after a crash mid-round restores the goal disarmed, and resume continues it | `session_start` 恢复成武装：第一条消息的 settle 就开第 2 轮；或 `resume` 后不续跑、轮号不接着来 |
| a model without tool calling gets no goal tools or command, and an active goal is marked unsupported | 不支持工具的模型仍拿到 goal 工具或 `/goal` 命令；`active` 目标没被标 `unsupported_model` |
| after compaction folds the first rounds, the next round prompt still carries the objective | 轮提示依赖历史给出目标（例如只有第 1 轮带目标），压缩后请求里就没有它 |
| a fork started in a goal round inherits the goal entries but cannot read, resume or continue the goal | fork 把继承来的目标当成自己的：`get_goal` 返回父目标，`resume` 武装后 fork 多出一个 goal 轮 |

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run --project agent-runtime packages/agent-runtime-pi/tests/goalRebuild.test.ts`
Expected: "without tool calling" 和 "a fork started in a goal round" FAIL（没有 `unsupported_model` 快照；fork 里 `get_goal` 成功、`resume` 后 fork 多出一个 goal 轮）；另两条 PASS（守任务 4 的恢复和任务 3 的提示词）。

- [ ] **Step 3: 实现门控快照**

把任务 4 的 `if (!port.modelSupportsTools()) return` 换成：

```ts
    if (!port.modelSupportsTools()) {
      // Spec §8.3: no tools and no command; an active goal on the branch records why nothing continues.
      pi.on('session_start', (_event, ctx) => {
        const goal = currentGoal(ctx.sessionManager.getBranch())
        if (goal?.phase === 'active')
          pi.appendEntry(
            GOAL_STATE_TYPE,
            stopGoal(goal, { code: 'unsupported_model', message: 'the current model has no tool calling' }, Date.now())
          )
      })
      return
    }
```

这个分支不需要子代理判断：不支持工具调用的模型调不了 `subagent`，不会有 fork。

- [ ] **Step 4: 实现子代理里不生效（spec §8.4）**

1. `src/goalState.ts` 的 `GoalErrorCode` 末尾加 `| 'in_subagent'`。现有的码都说的是目标本身的问题，没有一个表示"这个 session 不该碰目标"。
2. `src/goalExtension.ts` 加 `import { isSubagentSession } from './subagent'`（在 `./modelMessages` 之后）；`Runtime` 末尾加字段，初值 `inSubagent: false`：

```ts
  /** This is a subagent's session: the goal belongs to the main agent (spec §8.4). */
  inSubagent: boolean
```

3. `session_start` 处理器的第一行 `runtime.goal = currentGoal(ctx.sessionManager.getBranch())` 换成下面几行，之后的行（`armed`、`inGoalRound`、任务 8 的审批订阅）不变：

```ts
      const entries = ctx.sessionManager.getBranch()
      runtime.inSubagent = isSubagentSession(entries)
      // A fork inherits the parent's goal entries; the goal stays the parent's, so this session has none.
      if (runtime.inSubagent) return
      runtime.goal = currentGoal(entries)
```

4. 在 `requireGoal` 之前加：

```ts
    const requireMainAgent = () => {
      if (runtime.inSubagent)
        throw new GoalError(
          'in_subagent',
          'Goals belong to the main agent; a subagent cannot read or change them. Finish the task you were given and report back.'
        )
    }
```

   三个工具的 `execute` 第一行都调用它：`get_goal` 改成 `execute: async () => { requireMainAgent(); return ok() }`（oxfmt 会把它展开成多行）；`create_goal` 放在 `requireHumanTurn` 之前，`update_goal` 放在 `requireRevision` 之前（stale 错误会附上当前视图，门控必须先于它）。
5. `agent_before_settle` 处理器第一行加 `if (runtime.inSubagent) return undefined`。`runtime.goal` 在子代理里始终为空，`turn_start` / `message_end` / `tool_call` / `turn_end` / `agent_settled` 的现有 `!runtime.goal` / `runtime.goal?.phase` 判断已经让它们什么都不做。

- [ ] **Step 5: 跑测试确认通过**

Run: `pnpm exec vitest run --project agent-runtime packages/agent-runtime-pi/tests/goalRebuild.test.ts packages/agent-runtime-pi/tests/goal.test.ts packages/agent-runtime-pi/tests/goalStops.test.ts packages/agent-runtime-pi/tests/goalState.test.ts && pnpm --filter @cherrystudio/agent-runtime typecheck`
Expected: PASS（四个文件共 91 个用例）。

- [ ] **Step 6: 格式、lint、提交**

```bash
pnpm exec oxfmt --write packages/agent-runtime-pi/src/goalState.ts packages/agent-runtime-pi/src/goalExtension.ts packages/agent-runtime-pi/tests/goalRebuild.test.ts
pnpm exec oxlint --deny-warnings packages/agent-runtime-pi/src/goalState.ts packages/agent-runtime-pi/src/goalExtension.ts packages/agent-runtime-pi/tests/goalRebuild.test.ts
pnpm exec eslint packages/agent-runtime-pi/src/goalState.ts packages/agent-runtime-pi/src/goalExtension.ts packages/agent-runtime-pi/tests/goalRebuild.test.ts
git add packages/agent-runtime-pi/src/goalState.ts packages/agent-runtime-pi/src/goalExtension.ts packages/agent-runtime-pi/tests/goalRebuild.test.ts
git -c core.hooksPath=/dev/null commit -S --signoff -m "feat(agent-runtime): keep goals consistent across rebuilds, unsupported models and subagents"
git cat-file commit HEAD | grep -E '^gpgsig|Signed-off-by'
```

---

### Task 11: README 与收尾

**Files:**
- Modify: `packages/agent-runtime-pi/README.md`（Extensions 一节、Known gaps）

**Notes：**

- C12：AskUserQuestion 的 `outcome` 已写进 README（`README.md` 的 `createAskUserExtension` 一条），不再动。
- C16：plan 模式下不续跑归宿主，写进 Known gaps。
- README 只写代码真做到的：`/goal` 自己不发模型请求，但空闲时建目标或 resume 会开第一轮（P14）；`blocked` 在人类回合里直接接受、goal 轮里要连续 `blockedAfter` 轮，不比较原因是否相同（P15）。

- [ ] **Step 1: 写 README**

"## Extensions" 下第一段的 "Both tools are `model-only` …" 换成（加了第三个扩展后 "Both" 不再对，Q15）：

```markdown
Factories the host passes in `extensionFactories`. Their tools are `model-only` (never callable from
codemode scripts, so every call stays its own tool part) and use the names Cherry's renderer already
handles.
```

在 "## Extensions" 列表末尾加：

```markdown
- **`createGoalExtension(port)`** – a persisted objective the runtime keeps pushing while the
  model is idle. State lives in `cherry.goal` entries (one snapshot per change, a tombstone on
  clear); each round is a `cherry.goal-round` message the host maps to the "round N" header. Rounds
  continue only at `agent_before_settle` and count once Pi sends them on. Every stop is the
  runtime's: round cap (the last allowed round is a wrap-up), token or USD budget, no progress (two
  rounds hint, three stop; the same tool call three times in a round is blocked, five times ends
  the goal), a denied approval or a dismissed question, provider errors, abort.
  `update_goal(complete)` passes the host's `GoalVerifier` or, without one, needs evidence and a
  round that changed something; `update_goal(blocked)` is accepted at once in a human turn and in
  goal rounds only after `blockedAfter` consecutive rounds report it. A user message always goes
  first, and its turn does not count for the goal. Tools are `get_goal` / `create_goal` /
  `update_goal` with DSH's output shape. `/goal` makes no model request itself and reports through
  `cherry.goal-notice` entries; creating or resuming a goal on an idle session starts its first
  round. A rebuilt session restores the goal disarmed; `/goal resume` continues it. The budget also
  counts the `usage` a tool result carries, so a `subagent` call's requests count toward it. In a
  subagent's session the goal tools fail and nothing continues, so a fork ignores the goal entries
  it inherits. Design: `docs/superpowers/specs/2026-10-11-agent-runtime-goal-design.md`.
```

在 "The host's approval layer…" 段后加一段：

```markdown
The host sets `create_goal` to ask for approval, so a goal the model proposes is confirmed by the
user through the existing approval card.
```

Known gaps 加：

```markdown
- Goals: no `waiting` state for background work (the goal blocks with `waiting_subagents` when the
  host reports running background subagents, which only L6 adds) and no fresh-context (Ralph)
  mode. The package does not know the permission mode; keeping goals from running rounds in plan
  mode is up to the host.
```

- [ ] **Step 2: 文档门禁与 goal 测试**

Run: `pnpm docs:check && pnpm exec vitest run --project agent-runtime packages/agent-runtime-pi/tests/goal.test.ts packages/agent-runtime-pi/tests/goalState.test.ts packages/agent-runtime-pi/tests/goalStops.test.ts packages/agent-runtime-pi/tests/goalRebuild.test.ts packages/agent-runtime-pi/tests/askUser.test.ts && pnpm --filter @cherrystudio/agent-runtime typecheck && pnpm exec oxlint --deny-warnings packages/agent-runtime-pi/src packages/agent-runtime-pi/tests && pnpm exec eslint packages/agent-runtime-pi/src packages/agent-runtime-pi/tests`
Expected: 全部通过。整包和整仓的测试留给 CI（CLAUDE.md "Check what you changed"）。

- [ ] **Step 3: 提交**

```bash
git add packages/agent-runtime-pi/README.md
git -c core.hooksPath=/dev/null commit -S --signoff -m "docs(agent-runtime): document the goal extension"
git cat-file commit HEAD | grep -E '^gpgsig|Signed-off-by'
```

---

## Self-review 记录

- **Spec 覆盖**：§5 数据模型 → 任务 2、3；§6.0 首轮 → 任务 5 `startRound`（空闲时开轮，忙时只武装）；§6.1 记账与人类回合 → 任务 5 `turn_end` / `startHumanTurn`；§6.2 十一步 → 任务 5 `decide`，第 8 条任务 8；§6.3 接纳 → 任务 5 `admit`（两个接纳点，见任务 5 "spec 与 Pi 不符"）；§6.4 → 任务 5、8 的 `agent_settled`；§7.1 上限 → 任务 6；§7.2 无进展 → 任务 5（轮级计数、hint）和任务 7（轮内重复、截断）；§7.3 需要人 → 任务 8；§7.4 错误 → 任务 5 `decide` 第 2 条、任务 8 用例；§7.5 自报 → 任务 9；§7.6 停止压过续跑 → 任务 4 的命令 `ctx.abort()`、任务 5 用例、任务 8 `agent_settled`；§8 工具命令 → 任务 4（C2 在任务 5）；§8.3 门控、§8.4 子代理里不生效、§11 衔接 → 任务 10；§9 核验 → 任务 9；§10 端口 → 任务 4、8。
- **§13 测试计划逐行落点**：创建后空闲续跑、只在接纳后递增 → 任务 5 "an idle /goal starts round 1…"、"does not count a round that a later extension vetoed"；空闲时命令开轮、运行中只武装 → 任务 5 同一条和 "in confirm-each-round mode…"、"a command typed during a human turn only arms the goal…"；后加载扩展覆盖 → 任务 5 veto；用户消息在 `pendingMessages` → 任务 5 "yields to a user message waiting at the settle…"；wrap-up 与 `round_limit`、调高后 resume → 任务 6 前两条；token / 金额预算、无定价只按 token → 任务 6 第 3–5 条；子代理 usage → 任务 5；`hasRunningSubagents` → 任务 8；fork → 任务 10；无进展 hint / 停止 → 任务 7 前两条；轮内重复 → 任务 7 第 4 条；审批被拒 → 任务 8；`session.abort()` → 任务 8；`/goal pause` 在流式输出中生效 → 任务 5 "pausing an active goal stops its round…"；blocked 门槛 → 任务 9；陈旧 revision → 任务 4；goal 轮里的权限 → 任务 5 "refuses create, edit, pause and resume in a goal round"（人类回合一侧在任务 4）；重建后 disarmed → 任务 10；`confirm-each-round` → 任务 5；无 / 有 `verify` → 任务 9；`modelSupportsTools() === false` → 任务 10；压缩 → 任务 10（重建后请求一致由 L2 的 `transcript.test.ts` 覆盖）。
- **spec 相对本计划的三处调整**（已同步进 spec）：快照新增 `progressRounds`；命令反馈走 `cherry.goal-notice` 状态条目；`GoalVerifier` 收 `ConversationModelMessage[]`。另有两处 spec 与 Pi 的实际行为不符（接纳点、中止的可见位置），见任务 5，待 controller 裁定。
- **类型一致性**：`RoundDetails`、`GoalStopCode`、`GoalPort.defaults` 在任务 2–4 定义；任务 5 把 `Runtime.lastRoundProgressed` / `blockedRounds` 换成 `round` / `blocked`，任务 8 改名 `hasRunningSubagents` / `waiting_subagents`，任务 10 加 `inSubagent` 和 `in_subagent`。`stop()` / `commit()` / `notice()` 的签名贯穿任务 4–10；`completeGoal` / `blockGoal` 在任务 9 多一个 `ctx` 参数，调用处同时改。
- **Review Focus 覆盖**：1 → 任务 5 "a user message taken in during a goal run…"、"yields to a user message waiting at the settle…"；2 → 任务 4 "rejects a stale revision"；3 → 任务 7 "hints after two rounds without progress…"；4 → 任务 10 "a session rebuilt after a crash mid-round…"、任务 5 "resume refuses an active goal that has no round left"；5 → 任务 5 veto；6 → 任务 5 "counts the usage a subagent result reports…"；7 → 任务 10 fork；8 → 任务 8 "aborting the run pauses the goal…"；9 → 任务 5 "a command typed during a human turn…"。
- **怎么验证的**：重写任务 5–11 时，把任务 5 结束时和任务 10 结束时的 `goalState.ts`、`goalExtension.ts`、`goalSupport.ts` 和四个测试文件放在包内临时目录里跑通（任务 5 状态 59 个用例，最终 91 个），typecheck、`oxlint --deny-warnings`、`eslint`、`oxfmt` 都过；再逐条变异实现（去掉 `message_end` 接纳、去掉 `turn_start` 接纳、去掉人类回合、去掉第 7 条让路、按 turn 清零重复计数、截断算进展、只在 settle 前处理中止、旧的 `resume()`……四十多条），每条都让对应用例失败，唯一没被抓到的是子代理 `session_start` 的提前返回（见任务 10 Notes）。计划里的代码块就是这些文件的内容，路径换回包内；临时文件已删除。

## 预检结论落点（`.superpowers/sdd/2026-10-11-agent-runtime-goal/preflight-5-11.md`）

| ID | 落点 |
|---|---|
| X1 | 任务 5：命令轮在轮消息的 `message_end` 接纳，续跑轮在 `turn_start` 用 `tailRound` 接纳；"Pi 行为"第 1–3 条 |
| X2 | 任务 5：`message_end` 上的用户消息调用 `startHumanTurn()`；用例 "a user message taken in during a goal run…" |
| X3 | 任务 5：`promptIdle()`（`waitForIdle`）和 `heldModel()`；所有用例都等运行落定，不 sleep |
| X4 | 扩展里没有 `runtime.ctx` / `branch()`；`decide(event, ctx, …)`、`lastErrorMessage(ctx)`、`conversation(ctx)`、`completeGoal(…, ctx)`、`blockGoal(…, ctx)`，调用处在任务 9 改 |
| P1 | 仍成立：任务 6 的轮次序列已在临时副本上跑出 |
| P2 | 任务 5 `admit()` 清零 `runtime.repeat`；任务 7 第 4 条（变异：按 turn 清零时失败） |
| P3 | 任务 5 按轮记文字：只调工具的 turn 不更新本轮文字，`previousText` 在轮结束时更新；任务 7 第 1 条按此重写（`[work, work, work, hint]`、`progressRounds: 1`），脚本每轮都读 |
| P4 | 任务 8 的插入点对着任务 5 的 `decide()` / `turn_end` 写明 |
| P5 | 任务 9 读 `roundProgressed()` 和 `runtime.blocked`（任务 5 改名后的字段） |
| P6 | 任务 10：`agent_before_settle` 首行门控，`session_start` 提前返回 |
| P7 | `goalStops.test.ts` 的 import 按任务给出完整列表，`readGoal` 在任务 9 才加 |
| P8 | `goalSession()` 移进 `goalSupport.ts`（任务 5） |
| P9 | `readTool` / `echoTool` 在任务 7 定义于文件作用域；import 只在文件顶部，按任务替换整段 |
| P10 | 不变（最后写入的停止请求生效） |
| P11 | 不变；任务 8 的用例名写明审批被拒在本轮结束时停，不进门槛 |
| P12 | 任务 8、10 对 `goalState.ts` / `session_start` 的修改互不重叠，任务 10 写明替换哪一行 |
| P13 | 不变（`requireMainAgent()` 先于 `requireRevision()`） |
| P14 | 任务 11：README 写"`/goal` 自己不发模型请求；空闲时建目标或 resume 会开第一轮" |
| P15 | 任务 11：README 写连续 `blockedAfter` 个 goal 轮、人类回合直接接受，不说"同一条件"；任务 9 的代码按连续轮号计数 |
| P16 | 不变 |
| P17 | 任务 6 的 Files 列出 `goalState.ts` / `goalState.test.ts` |
| Q1 | 每个任务写明 import 的增减；临时副本上各状态的 typecheck 和 lint 已过 |
| Q2 | 不变；任务 5 用现成助手，`resume()` 按 C1 改 |
| Q3 | 任务 5 Step 1 改写任务 4 的用例（`promptIdle`、`confirmEachRound`、`heldGoalSession`、只数 `roundsStarted === 0` 的快照）；附带问题见任务 5 Notes |
| Q4 | 任务 5 改 `tailRound`（越过非消息条目）并改它的单元测试 |
| Q5 | 不变；`toolResultOf` 不再需要（D1 用字面值） |
| Q6 | 任务 6 Step 1–3：两条 `goalState` 用例、`editGoal` 加 `hasCapacity`、单独的 `fix` 提交 |
| Q7 | 任务 7 Step 3 加 `toolCallKey` import |
| Q8 | 不变（任务 8 防御性读取） |
| Q9 | 不变（任务 8 Step 1） |
| Q10 | 任务 9：不再用 `VERIFY_MESSAGES`，传整个当前上下文；import `buildSessionContext` / `convertToLlm` / `toModelMessages`；新签名和调用处 |
| Q11 | 任务 9：`buildSessionContext(ctx.sessionManager.getEntries(), ctx.sessionManager.getLeafId())` |
| Q12 | spec 7be08c2c58 已改；任务 9 按轮号数连续上报，人类回合（任务 5）和用户编辑（任务 9 `commitEdit`）清零 |
| Q13 | 不变 |
| Q14 | 不变 |
| Q15 | 任务 11 改写 "Both tools are `model-only`" 一句 |
| S5 | S5.1 → 任务 5 权限用例覆盖四个动作；S5.2 → 删掉错误的 Step 4 说明；S5.3 → spec 进了任务 5 的 Files；edit 落入创建 → 任务 5 C2 用例 |
| S6 | 见 Q6、D3、P7；X1 / X3 已解决 |
| S7 | S7.1 → 任务 7 脚本用单个 `(prompt, call)` 脚本加 `roundStart`；S7.2 → Step 2 写明前两条直接通过；S7.3 → 标题改为 "stops after the third" |
| S8 | D9 → 标题改为 "blocks"；X1 / X3 / X4 已解决 |
| S9 | S9.1 → 任务 9 `await` 后 `requireRevision` 加用例；S9.2 → pause-on-complete 用例；S9.3 → spec 已改，人类回合直接接受并有用例；S9.4 → Step 2 按用例写占位错误；S9.5 → 断言 `isError === false` |
| S10 | S10.1 → 任务 10 用崩溃的 transcript 得到 `active` 目标 |
| S11 | 见 P14、P15、Q15 |
| C1 | 任务 5：`resume()` 先调 `resumeGoal`；用例 "resume refuses an active goal that has no round left" |
| C2 | 任务 5：`edit` 分支加 `runtime.goal` 条件；用例 "with no goal, a leading edit…" |
| C3 | 任务 6 Step 1–3 |
| C4 | 任务 5 Step 5 |
| C5 | 任务 8（`details?.outcome`） |
| C6 | 已在代码里，任务 5 不动 `commit()` |
| C7 | 任务 9：CAS 复核和 pause-on-complete 两条用例 |
| C8 | 任务 10 第 1 条用例（`active` 目标、状态文本里的 activation） |
| C9 | 任务 5 权限用例 |
| C10 | 任务 5 `tailRound` |
| C11 | 任务 5 照用现成助手 |
| C12 | 任务 11 Notes：不再动 |
| C13 | 任务 5 `goalState` 单元测试 `isProgressResult(result('subagent'))` |
| C14 | 任务 8 Step 1 |
| C15 | `in_subagent`（任务 10）、`hasRunningSubagents`（任务 8）、§7.6 说明（任务 5） |
| C16 | 任务 11 Known gaps |
| D1 | 任务 5：`tokensUsed: 1553`、`costUsed ≈ 0.0020608` 字面值 |
| D2 | 任务 5：让路用例在 settle 时排队（去掉第 7 条即失败）；运行内取走的另起一条用例 |
| D3 | 任务 6：先拒 5000，再接受 2 并只跑 2 轮 |
| D4 | 任务 9：退化检查两条都测到 |
| D5 | 任务 10：`active` 目标加 activation 检查 |
| D6 | 任务 10：断言压缩后的请求没有第 1 轮回复、最后一条消息仍含目标（变异：只在第 1 轮带目标时失败） |
| D7 | 共用助手进 `goalSupport.ts`；`approvals()` 工厂加 `it.each`；`askEachRound` 只写一次；用 `finish(…, input, output)` 不复制 `sizedFinish`；任务 5 第 1 条测接纳与送达，wrap-up 归任务 6 |
| D8 | `decide()` 用 `projected` 副本做预算判断，不重复 `commit()` 的折入；`blockGoal` 只有一个出口 |
| D9 | 任务 8 用例标题 |
| D10 | 脚本不再有未用的参数（用 `_prompt`） |
| D11 | spec:460 → 任务 5 "a command typed during a human turn…"；spec:475 → 任务 5 权限用例；spec:470 → 任务 8 审批用例；spec:480 → 任务 10 命令未注册；spec:464 → 任务 6 无定价用例；spec:481 → 任务 10 压缩用例（重建一致见上）；§7.2 `subagent` 算进展 → 任务 5 单元测试 |
