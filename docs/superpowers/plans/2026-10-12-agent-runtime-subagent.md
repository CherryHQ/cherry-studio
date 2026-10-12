# Agent runtime 子代理（L4）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `packages/agent-runtime` 里加前台子代理：`subagent({ description, prompt, fork? })` 工具在进程内建一个子 Pi 会话，跑完把最终报告作为这次调用的结果交回父会话。

**Architecture:** 新文件 `src/subagent.ts` 放宿主接口类型、工具注册、子会话运行和 fork 的 transcript 拼接；`session.ts` 在宿主传了 `subagents` 时注册这个扩展，并借给它两样东西：用父会话选项建子会话的函数、父会话当前的 transcript。子代理识别用一条 `cherry.subagent-origin` 状态条目，`AskUserQuestion` 据此在子代理里直接返回 `unavailable`。

**Tech Stack:** TypeScript、`@earendil-works/pi-coding-agent` 1.1.0 扩展 API、`@earendil-works/pi-ai` 的 TypeBox `Type`、AI SDK v6、Vitest 5、包内 `tests/support.ts`。

**Spec:** `docs/superpowers/specs/2026-10-11-agent-runtime-subagent-design.md`

## Global Constraints

- 包不 import `src/`、`@main`、`@shared`、`@logger`、`@application`、`@data`，不写日志（README "Boundaries"）。
- 工具名 `subagent`，参数 `description`、`prompt`、`fork?`；`exposure: 'model-only'`；不延迟加载（spec §3）。
- 宿主接口名称照抄 spec §7：`subagents?: SubagentPort`、`SubagentPort.configure(subagent: Subagent)`、`Subagent { parentToolCallId, sessionId, fork }`、`SubagentSessionOptions { extensionFactories?, onEvent?, onSessionCreated? }`、`SubagentDetails { sessionId, fork, outcome }`。名字里不出现 `child`。
- `outcome` 取值：`'completed' | 'failed' | 'truncated' | 'aborted' | 'limit_reached'`（spec §6）。
- 状态条目 `cherry.subagent-origin`，数据 `{ parentToolCallId, fork }`（spec §5）。
- 子会话 id：`${父 sessionId}/${toolCallId}`（spec §4.5）。
- 子会话用 `session.prompt()` 启动，不用 `sendCustomMessage`（spec §4.4）。
- 用量放在 `AgentToolResult.usage`，不放进 `details`；失败用 `isError: true` 返回，不抛错（spec §6）。
- 每个子代理最多 200 次模型请求（spec §6）。
- fork 子会话的工具必须与父会话逐项相同；不该用的工具调用时拒绝，不从工具池拿掉（spec §4.2）。
- 行内注释最多两行，只写原因（CLAUDE.md）。
- 测试：每个测试写明破坏什么时失败；不写只记录现状的测试（CLAUDE.md "No behavior-pinning tests"）。
- 提交：`git commit -S --signoff`，Conventional Commits，scope `agent-runtime`，不加署名行。
- 门禁（在仓库根 `/Users/xuan/Desktop/testSpace/cherry-studio-agent-runtime` 运行）：`pnpm exec vitest run --project agent-runtime <测试文件>`、`pnpm --filter @cherrystudio/agent-runtime typecheck`、`pnpm exec oxlint --deny-warnings <改动文件>`、`pnpm exec eslint <改动文件>`、`pnpm exec oxfmt --write <改动文件>`。

## Review Focus

spec 没有逐条写、但实际会碰到的输入。每条都在所属任务里加了测试：

1. 生产环境里每个宿主回合都从 transcript 重建会话，fork 发生在重建后的会话里：fork 必须带上重放的历史（任务 3）。
2. 同一步里 fork 和别的工具调用混在一起：这一步的每个调用都要补同一条占位结果（任务 3）。
3. 子代理最后一条回复没有文字（弱模型常见）：父代理要拿到一句固定说明，而不是空结果（任务 1）。
4. 子代理报告很长：父会话的 offload 照样生效，不能撑爆父上下文（任务 1）。
5. 同一步两个子代理一个失败：另一个的报告照常返回（任务 4）。

## 文件结构

| 文件 | 职责 |
|---|---|
| `packages/agent-runtime-pi/src/subagent.ts` | 新建。宿主接口类型、`SUBAGENT_TOOL_NAME`、`SUBAGENT_ORIGIN_STATE`、`isSubagentSession`、`subagentExtension`、fork transcript 拼接、子会话运行与结果 |
| `packages/agent-runtime-pi/src/session.ts` | 加 `subagents` 选项，注册 `subagentExtension` 并借给它建会话函数和父 transcript |
| `packages/agent-runtime-pi/src/askUserExtension.ts` | 子代理里直接返回 `unavailable`（任务 2） |
| `packages/agent-runtime-pi/src/aiSdkProvider.ts` | 已中止的请求不进 port（任务 4） |
| `packages/agent-runtime-pi/src/index.ts` | 导出 |
| `packages/agent-runtime-pi/README.md` | 新增「Subagents」一节，宿主须知，Known gaps |
| `packages/agent-runtime-pi/tests/subagentSupport.ts` | 新建。`routedModel`、`toolCallPart`、`subagentCall`、`recordingSubagentPort`、`toolResults`、`outputText`、`toolResultOf`、`noteTool` |
| `packages/agent-runtime-pi/tests/subagent.test.ts` | 新建。普通子代理、识别与 `AskUserQuestion` |
| `packages/agent-runtime-pi/tests/subagentFork.test.ts` | 新建。fork |
| `packages/agent-runtime-pi/tests/subagentStops.test.ts` | 新建。失败、中止、请求上限 |
| `packages/agent-runtime-pi/tests/bridge.test.ts` | 加一条：已中止的请求不进 port（任务 4） |

---

### Task 1: 普通子代理

**Files:**
- Create: `packages/agent-runtime-pi/src/subagent.ts`
- Modify: `packages/agent-runtime-pi/src/session.ts`（import、`AgentRuntimeSessionOptions`、`extensionFactories` 数组）
- Modify: `packages/agent-runtime-pi/src/index.ts`
- Modify: `packages/agent-runtime-pi/README.md`
- Create: `packages/agent-runtime-pi/tests/subagentSupport.ts`
- Create: `packages/agent-runtime-pi/tests/subagent.test.ts`

**Interfaces:**
- Consumes: `createAgentRuntimeSession`、`AgentRuntimeSession`（`session.ts`）；`AgentRuntimeEvent`（`transcriptTap.ts`）；`TranscriptEntry`（`transcript.ts`）。
- Produces（后续任务依赖）：
  - `SUBAGENT_TOOL_NAME = 'subagent'`
  - `interface SubagentPort { configure(subagent: Subagent): SubagentSessionOptions | Promise<SubagentSessionOptions> }`
  - `interface Subagent { parentToolCallId: string; sessionId: string; fork: boolean }`
  - `interface SubagentSessionOptions { extensionFactories?: ExtensionFactory[]; onEvent?: (event: AgentRuntimeEvent) => void; onSessionCreated?: (session: AgentSession) => void }`
  - `interface SubagentDetails { sessionId: string; fork: boolean; outcome: 'completed' | 'failed' | 'truncated' | 'aborted' | 'limit_reached' }`
  - 包内：`interface SubagentSessionOverrides { sessionId: string; transcript: TranscriptEntry[]; extensionFactories: ExtensionFactory[]; onEvent: ((event: AgentRuntimeEvent) => void) | undefined }`、`interface SubagentToolOptions { port: SubagentPort; createSession: (overrides: SubagentSessionOverrides) => Promise<AgentRuntimeSession> }`、`function subagentExtension(options: SubagentToolOptions): ExtensionFactory`、`async function run(child: AgentRuntimeSession, prompt: string, base: Omit<SubagentDetails, 'outcome'>): Promise<AgentToolResult<SubagentDetails>>`
  - `AgentRuntimeSessionOptions.subagents?: SubagentPort`
  - 测试助手（见 Step 1）

- [ ] **Step 1: 写测试助手 `tests/subagentSupport.ts`**

```ts
import type { LanguageModelV3CallOptions, LanguageModelV3Message, LanguageModelV3StreamPart } from '@ai-sdk/provider'
import { Type, type ToolResultMessage } from '@earendil-works/pi-ai'
import { type AgentSession, defineTool } from '@earendil-works/pi-coding-agent'
import { simulateReadableStream } from 'ai'
import { MockLanguageModelV3 } from 'ai/test'

import type { AgentRuntimeEvent, Subagent, SubagentPort, SubagentSessionOptions } from '../src'

export interface RoutedCall {
  /** Role of the last prompt message: `user` on a new request, `tool` after tool results. */
  lastRole: string
  /** Text of every user message in the prompt, joined. */
  userText: string
  options: LanguageModelV3CallOptions
}

const userTextOf = (message: LanguageModelV3Message) =>
  message.role === 'user' ? message.content.map((part) => (part.type === 'text' ? part.text : '')).join('') : ''

/**
 * A mock that answers each call with the script `route` picks for it, so a parent and its
 * subagents can share one model (and one port) the way they do in production.
 */
export function routedModel(route: (call: RoutedCall) => LanguageModelV3StreamPart[]) {
  const calls: RoutedCall[] = []
  const model = new MockLanguageModelV3({
    doStream: async (options) => {
      const call: RoutedCall = {
        lastRole: options.prompt.at(-1)?.role ?? '',
        userText: options.prompt.map(userTextOf).join('\n'),
        options
      }
      calls.push(call)
      return { stream: simulateReadableStream({ chunks: route(call) }) }
    }
  })
  return { model, calls }
}

export const toolCallPart = (toolCallId: string, toolName: string, input: object = {}): LanguageModelV3StreamPart => ({
  type: 'tool-call',
  toolCallId,
  toolName,
  input: JSON.stringify(input)
})

export const subagentCall = (toolCallId: string, input: { description: string; prompt: string; fork?: boolean }) =>
  toolCallPart(toolCallId, 'subagent', input)

/** A host port that records each subagent it configures and the events and session that subagent gets. */
export function recordingSubagentPort(
  extra: (subagent: Subagent) => SubagentSessionOptions | Promise<SubagentSessionOptions> = () => ({})
) {
  const subagents: Subagent[] = []
  const events = new Map<string, AgentRuntimeEvent[]>()
  const sessions = new Map<string, AgentSession>()
  const port: SubagentPort = {
    async configure(subagent) {
      subagents.push(subagent)
      const received: AgentRuntimeEvent[] = []
      events.set(subagent.sessionId, received)
      const options = await extra(subagent)
      return {
        ...options,
        onEvent: (event) => received.push(event),
        onSessionCreated: (session) => {
          sessions.set(subagent.sessionId, session)
          options.onSessionCreated?.(session)
        }
      }
    }
  }
  return { port, subagents, events, sessions }
}

/** Tool results in a call's prompt, in order. */
export function toolResults(call: RoutedCall) {
  return call.options.prompt
    .flatMap((message) => (message.role === 'tool' ? message.content : []))
    .flatMap((part) => (part.type === 'tool-result' ? [part] : []))
}

/** The text the model saw for a tool result output. */
export function outputText(output: unknown): string {
  const value = (output as { value?: unknown }).value
  return typeof value === 'string' ? value : JSON.stringify(output)
}

/** The result Pi recorded for a tool call in a session. */
export function toolResultOf(session: AgentSession, toolCallId: string): ToolResultMessage {
  const result = session.messages.find(
    (message): message is ToolResultMessage => message.role === 'toolResult' && message.toolCallId === toolCallId
  )
  if (!result) throw new Error(`no result for ${toolCallId}`)
  return result
}

export const noteTool = defineTool({
  name: 'note',
  label: 'Note',
  description: 'Write a note',
  parameters: Type.Object({}),
  async execute() {
    return { content: [{ type: 'text', text: 'noted' }], details: undefined }
  }
})
```

- [ ] **Step 2: 写失败的测试 `tests/subagent.test.ts`**

```ts
import { Type } from '@earendil-works/pi-ai'
import { defineTool } from '@earendil-works/pi-coding-agent'
import { describe, expect, it } from 'vitest'

import type { ToolOutputStore } from '../src'
import { createTestSession, finish, hostStore, scriptedModel, streamTextPort, textParts } from './support'
import {
  noteTool,
  outputText,
  recordingSubagentPort,
  routedModel,
  subagentCall,
  toolCallPart,
  toolResultOf,
  toolResults
} from './subagentSupport'

const DELEGATE_A = 'Delegate the check of module A'
const TASK_A = { description: 'Check module A', prompt: 'TASK-A: inspect module A' }

/** Parent delegates TASK-A once; the subagent writes a note, then reports. */
function delegateOnce(report: string[] = ['REPORT-A']) {
  return routedModel(({ userText, lastRole }) => {
    if (userText.includes('TASK-A'))
      return lastRole === 'user'
        ? [toolCallPart('note_1', 'note'), finish('tool-calls', 100, 20)]
        : [...textParts('r', ...report), finish('stop', 200, 40)]
    return lastRole === 'user'
      ? [subagentCall('call_a', TASK_A), finish('tool-calls')]
      : [...textParts('d', 'Done'), finish('stop')]
  })
}

describe('subagent', () => {
  it('runs a fresh subagent in its own context and returns its final message, session id and usage', async () => {
    const { model, calls } = delegateOnce()
    const host = recordingSubagentPort()
    const { session } = await createTestSession({
      port: streamTextPort(model).port,
      tools: [noteTool],
      subagents: host.port
    })

    await session.prompt(DELEGATE_A)

    expect(calls[0].options.tools?.map((tool) => tool.name)).toContain('subagent')
    const first = calls.find((call) => call.userText.includes('TASK-A'))!
    expect(first.options.prompt.map((message) => message.role)).toEqual(['system', 'user'])
    expect(first.userText).not.toContain(DELEGATE_A)
    expect(first.options.tools?.map((tool) => tool.name)).not.toContain('subagent')
    expect(toolResults(calls.at(-1)!).map((part) => outputText(part.output))).toEqual(['REPORT-A'])

    const result = toolResultOf(session, 'call_a')
    expect(result.isError).toBe(false)
    expect(result.details).toEqual({ sessionId: `${session.sessionId}/call_a`, fork: false, outcome: 'completed' })
    // Two replies: 100 + 20 + 2 cached and 200 + 40 + 2 cached tokens.
    expect(result.usage?.totalTokens).toBe(364)
    expect(result.usage?.cost.total).toBeCloseTo(0.0004204, 10)
  })

  it('offers subagent only when the host passes a subagent port', async () => {
    const { model, calls } = scriptedModel([[...textParts('a', 'Hi'), finish('stop')]])
    const { session } = await createTestSession({ port: streamTextPort(model).port })

    await session.prompt('Hello')

    expect(calls[0].tools?.map((tool) => tool.name) ?? []).not.toContain('subagent')
  })

  it('sends subagent entries only to its own listener; the parent transcript gains only the call and its result', async () => {
    const { model } = delegateOnce()
    const host = recordingSubagentPort()
    const parent = hostStore()
    const { session } = await createTestSession({
      port: streamTextPort(model).port,
      tools: [noteTool],
      subagents: host.port,
      onEvent: parent.onEvent
    })

    await session.prompt(DELEGATE_A)

    const roles = (entries: typeof parent.entries) =>
      entries.map((entry) => (entry.kind === 'message' ? entry.message.role : entry.kind))
    expect(roles(parent.entries)).toEqual(['user', 'assistant', 'tool', 'assistant'])
    expect(JSON.stringify(parent.entries)).not.toContain('noted')
    const childEvents = host.events.get(`${session.sessionId}/call_a`)!
    const childEntries = childEvents.flatMap((event) => (event.type === 'transcript-append' ? event.entries : []))
    expect(roles(childEntries)).toEqual(['user', 'assistant', 'tool', 'assistant'])
    expect(childEvents.at(-1)).toMatchObject({ type: 'turn-complete', aborted: false })
  })

  it('hands the subagent session to the host before its first model request', async () => {
    const { model, calls } = delegateOnce()
    const seen: { sessionId: string; requestsBefore: number }[] = []
    const host = recordingSubagentPort(() => ({
      onSessionCreated: (child) =>
        seen.push({
          sessionId: child.sessionId,
          requestsBefore: calls.filter((call) => call.userText.includes('TASK-A')).length
        })
    }))
    const { session } = await createTestSession({
      port: streamTextPort(model).port,
      tools: [noteTool],
      subagents: host.port
    })

    await session.prompt(DELEGATE_A)

    expect(seen).toEqual([{ sessionId: `${session.sessionId}/call_a`, requestsBefore: 0 }])
  })

  it('runs host before_agent_start handlers inside the subagent', async () => {
    const { model, calls } = delegateOnce()
    const host = recordingSubagentPort(() => ({
      extensionFactories: [
        (pi) =>
          pi.on('before_agent_start', () => ({
            message: { customType: 'cherry.test-note', content: 'NOTE-FOR-SUBAGENT', display: false }
          }))
      ]
    }))
    const { session } = await createTestSession({
      port: streamTextPort(model).port,
      tools: [noteTool],
      subagents: host.port
    })

    await session.prompt(DELEGATE_A)

    expect(calls.find((call) => call.userText.includes('TASK-A'))!.userText).toContain('NOTE-FOR-SUBAGENT')
  })

  it('runs the subagent calls of one step at the same time', async () => {
    let active = 0
    let maxActive = 0
    const waitTool = defineTool({
      name: 'wait',
      label: 'Wait',
      description: 'Wait a moment',
      parameters: Type.Object({}),
      async execute() {
        maxActive = Math.max(maxActive, ++active)
        await new Promise((resolve) => setTimeout(resolve, 50))
        active--
        return { content: [{ type: 'text', text: 'waited' }], details: undefined }
      }
    })
    const { model } = routedModel(({ userText, lastRole }) => {
      for (const task of ['TASK-A', 'TASK-B'])
        if (userText.includes(task))
          return lastRole === 'user'
            ? [toolCallPart('wait_1', 'wait'), finish('tool-calls')]
            : [...textParts('r', `REPORT ${task}`), finish('stop')]
      return lastRole === 'user'
        ? [
            subagentCall('call_a', { description: 'Check A', prompt: 'TASK-A' }),
            subagentCall('call_b', { description: 'Check B', prompt: 'TASK-B' }),
            finish('tool-calls')
          ]
        : [...textParts('d', 'Done'), finish('stop')]
    })
    const { session } = await createTestSession({
      port: streamTextPort(model).port,
      tools: [waitTool],
      subagents: recordingSubagentPort().port
    })

    await session.prompt('Check modules A and B')

    expect(maxActive).toBe(2)
  })

  it('tells the parent when the subagent ends without a final message', async () => {
    const { model, calls } = routedModel(({ userText, lastRole }) => {
      if (userText.includes('TASK-A')) return [finish('stop')]
      return lastRole === 'user'
        ? [subagentCall('call_a', TASK_A), finish('tool-calls')]
        : [...textParts('d', 'Done'), finish('stop')]
    })
    const { session } = await createTestSession({
      port: streamTextPort(model).port,
      subagents: recordingSubagentPort().port
    })

    await session.prompt(DELEGATE_A)

    const [result] = toolResults(calls.at(-1)!)
    expect(result.output.type).toBe('text')
    expect(outputText(result.output)).toMatch(/without a final message/)
  })

  it('offloads an oversized subagent report like any other tool result', async () => {
    const saved: { toolName: string }[] = []
    const store: ToolOutputStore = {
      async save(file) {
        saved.push({ toolName: file.toolName })
        return `/offload/${file.name}`
      }
    }
    const { model, calls } = delegateOnce(['R'.repeat(20_000)])
    const { session } = await createTestSession({
      port: streamTextPort(model).port,
      tools: [noteTool],
      subagents: recordingSubagentPort().port,
      offload: { store, thresholdChars: 5_000 }
    })

    await session.prompt(DELEGATE_A)

    expect(saved).toEqual([{ toolName: 'subagent' }])
    expect(outputText(toolResults(calls.at(-1)!)[0].output)).toContain('<persisted-output>')
  })

  it('rejects a call with an empty prompt without configuring a subagent', async () => {
    const { model, calls } = routedModel(({ lastRole }) =>
      lastRole === 'user'
        ? [subagentCall('call_a', { description: 'Check A', prompt: '   ' }), finish('tool-calls')]
        : [...textParts('d', 'Done'), finish('stop')]
    )
    const host = recordingSubagentPort()
    const { session } = await createTestSession({ port: streamTextPort(model).port, subagents: host.port })

    await session.prompt(DELEGATE_A)

    expect(host.subagents).toEqual([])
    const [result] = toolResults(calls.at(-1)!)
    expect(result.output.type).toBe('error-text')
    expect(outputText(result.output)).toMatch(/non-empty description and prompt/)
  })
})
```

各测试在什么情况下失败：子代理串了父会话上下文、结果取错消息、用量没累加或不在 `usage` 上（第 1 条）；没传端口也注册了工具（第 2 条）；子代理条目进了父会话的 `onEvent`（第 3 条）；`onSessionCreated` 晚于第一次请求（第 4 条）；用了不触发 `before_agent_start` 的启动方式（第 5 条）；子代理被串行执行（第 6 条）；无文字时返回空结果（第 7 条）；子代理结果绕过 offload（第 8 条）；空 prompt 仍建子会话（第 9 条）。

- [ ] **Step 3: 运行测试，确认失败**

Run: `pnpm exec vitest run --project agent-runtime packages/agent-runtime-pi/tests/subagent.test.ts`
Expected: FAIL，类型错误或 `subagents` 不存在（`subagent` 工具未注册）。

- [ ] **Step 4: 写 `src/subagent.ts`**

```ts
import { Type, type Usage } from '@earendil-works/pi-ai'
import type { AgentSession, AgentToolResult, ExtensionFactory } from '@earendil-works/pi-coding-agent'

import type { AgentRuntimeSession } from './session'
import type { TranscriptEntry } from './transcript'
import type { AgentRuntimeEvent } from './transcriptTap'

/** DSH's name: Cherry's renderer shows a cherry-runtime `subagent` call as a Task card. */
export const SUBAGENT_TOOL_NAME = 'subagent'

/** Host side of `subagent`: gives each subagent its extensions and listeners. */
export interface SubagentPort {
  /** Called once per subagent, before its session is built. A throw fails the call. */
  configure(subagent: Subagent): SubagentSessionOptions | Promise<SubagentSessionOptions>
}

/** The subagent about to be created. */
export interface Subagent {
  /** The `subagent` call that creates it. */
  parentToolCallId: string
  /** Its Pi session id and its requests' `sessionId`: `<parent session id>/<parentToolCallId>`. */
  sessionId: string
  fork: boolean
}

/** The session options the host gives each subagent; everything else comes from the parent. */
export interface SubagentSessionOptions {
  extensionFactories?: ExtensionFactory[]
  /** The subagent's own transcript events, shaped like the parent's `onEvent`; they never reach the parent's. */
  onEvent?: (event: AgentRuntimeEvent) => void
  /** Called before the subagent's first model request; subscribe to its live output here. */
  onSessionCreated?: (session: AgentSession) => void
}

/** `details` of every result the tool returns once the host configured the subagent. */
export interface SubagentDetails {
  sessionId: string
  fork: boolean
  outcome: 'completed' | 'failed' | 'truncated' | 'aborted' | 'limit_reached'
}

/** What a subagent's session overrides in the parent's options. */
export interface SubagentSessionOverrides {
  sessionId: string
  transcript: TranscriptEntry[]
  extensionFactories: ExtensionFactory[]
  onEvent: ((event: AgentRuntimeEvent) => void) | undefined
}

/** What the session that registers `subagent` lends it. */
export interface SubagentToolOptions {
  port: SubagentPort
  /** Builds a session from the parent's options with these overrides. */
  createSession: (overrides: SubagentSessionOverrides) => Promise<AgentRuntimeSession>
}

const DESCRIPTION = [
  'Delegate a task to a subagent: a separate agent with the same tools that returns only its final report, so the work does not fill this conversation.',
  '- The subagent starts with an empty context: put everything it needs in the prompt.',
  '- Start independent subagents together in one message; they run at the same time.',
  '- You see the final report, not the intermediate steps.'
].join('\n')

const PREAMBLE =
  'You are a subagent working for another agent, not for the user. Do the task below with your tools, then finish with one final message that reports the result in full — the other agent sees only that final message. You cannot ask the user questions and you cannot start subagents.'

const NO_FINAL_MESSAGE = 'The subagent finished without a final message.'

const parameters = Type.Object({
  description: Type.String({ description: 'A short (3-5 word) title of the task, shown to the user.' }),
  prompt: Type.String({ description: 'The task for the subagent.' })
})

const text = (value: string) => ({ type: 'text' as const, text: value })
const taskText = (prompt: string) => `${PREAMBLE}\n\nTask:\n${prompt}`

const zeroUsage = (): Usage => ({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
})

function addUsage(sum: Usage, usage: Usage): Usage {
  return {
    input: sum.input + usage.input,
    output: sum.output + usage.output,
    cacheRead: sum.cacheRead + usage.cacheRead,
    cacheWrite: sum.cacheWrite + usage.cacheWrite,
    ...(sum.reasoning === undefined && usage.reasoning === undefined
      ? {}
      : { reasoning: (sum.reasoning ?? 0) + (usage.reasoning ?? 0) }),
    totalTokens: sum.totalTokens + usage.totalTokens,
    cost: {
      input: sum.cost.input + usage.cost.input,
      output: sum.cost.output + usage.cost.output,
      cacheRead: sum.cost.cacheRead + usage.cost.cacheRead,
      cacheWrite: sum.cost.cacheWrite + usage.cost.cacheWrite,
      total: sum.cost.total + usage.cost.total
    }
  }
}

/** Runs the task to settlement; the result carries the subagent's final message and the sum of its usage. */
async function run(
  child: AgentRuntimeSession,
  prompt: string,
  base: Omit<SubagentDetails, 'outcome'>
): Promise<AgentToolResult<SubagentDetails>> {
  const { session } = child
  const start = session.messages.length
  let error: string | undefined
  try {
    await session.prompt(taskText(prompt), { expandPromptTemplates: false, source: 'extension' })
  } catch (thrown) {
    error = thrown instanceof Error ? thrown.message : String(thrown)
  }
  const replies = session.messages.slice(start).filter((message) => message.role === 'assistant')
  const usage = replies.reduce((sum, reply) => addUsage(sum, reply.usage), zeroUsage())
  const last = replies.at(-1)
  if (error === undefined && last?.stopReason === 'stop') {
    const finalText = last.content.map((block) => (block.type === 'text' ? block.text : '')).join('').trim()
    return { content: [text(finalText || NO_FINAL_MESSAGE)], details: { ...base, outcome: 'completed' }, usage }
  }
  return {
    content: [text(`The subagent failed: ${error ?? last?.errorMessage ?? 'it ended without a reply'}`)],
    details: { ...base, outcome: 'failed' },
    usage,
    isError: true
  }
}

/** The `subagent` tool: each call runs a subagent session in-process and returns its final report. */
export function subagentExtension({ port, createSession }: SubagentToolOptions): ExtensionFactory {
  return (pi) => {
    pi.registerTool({
      name: SUBAGENT_TOOL_NAME,
      label: 'Subagent',
      description: DESCRIPTION,
      parameters,
      exposure: 'model-only',
      async execute(toolCallId, params, _signal, _onUpdate, ctx) {
        const description = params.description.trim()
        const prompt = params.prompt.trim()
        if (!description || !prompt) throw new Error('A subagent needs a non-empty description and prompt.')
        const subagent: Subagent = {
          parentToolCallId: toolCallId,
          sessionId: `${ctx.sessionManager.getSessionId()}/${toolCallId}`,
          fork: false
        }
        const options = await port.configure(subagent)
        const child = await createSession({
          sessionId: subagent.sessionId,
          transcript: [],
          extensionFactories: options.extensionFactories ?? [],
          onEvent: options.onEvent
        })
        try {
          options.onSessionCreated?.(child.session)
          return await run(child, prompt, { sessionId: subagent.sessionId, fork: false })
        } finally {
          await child.dispose()
        }
      }
    })
  }
}
```

如果 `session.messages.slice(start).filter((message) => message.role === 'assistant')` 没有被 TypeScript 推断成 `AssistantMessage[]`，改成显式类型守卫 `(message): message is AssistantMessage => message.role === 'assistant'`，`AssistantMessage` 从 `@earendil-works/pi-ai` 引入。

- [ ] **Step 5: 在 `src/session.ts` 注册**

import 区加：

```ts
import { subagentExtension, type SubagentPort } from './subagent'
```

`AgentRuntimeSessionOptions` 里 `recall` 之后加：

```ts
  /** Registers `subagent`; the host configures each subagent through this port. Off when omitted. */
  subagents?: SubagentPort
```

`extensionFactories` 数组里，`recall` 那一行之后、`...(options.extensionFactories ?? [])` 之前加：

```ts
    ...(options.subagents
      ? [
          subagentExtension({
            port: options.subagents,
            createSession: (overrides) =>
              createAgentRuntimeSession({ ...options, ...overrides, subagents: undefined })
          })
        ]
      : []),
```

- [ ] **Step 6: 在 `src/index.ts` 导出**

在 `./session` 的导出之后加：

```ts
export {
  SUBAGENT_TOOL_NAME,
  type Subagent,
  type SubagentDetails,
  type SubagentPort,
  type SubagentSessionOptions
} from './subagent'
```

- [ ] **Step 7: 运行测试，确认通过**

Run: `pnpm exec vitest run --project agent-runtime packages/agent-runtime-pi/tests/subagent.test.ts`
Expected: PASS（9 个测试）

- [ ] **Step 8: README 新增「Subagents」一节**

在 `## Extensions` 之前插入：

```markdown
## Subagents

`subagents: SubagentPort` registers `subagent({ description, prompt })`, a `model-only` tool with DSH's
name, so Cherry's renderer shows it as a Task card. Each call builds a session in-process from the
parent's options (port, request options, model, prompts, tools, compaction, offload, recall,
settings) plus the extensions the host returns from `SubagentPort.configure(subagent)`, starts it
with `session.prompt()` so `before_agent_start` handlers run as in any turn, waits for it to settle
and disposes it. The call blocks: the subagent's final message is the call's result, `details` is
`{ sessionId, fork, outcome }`, and the result's `usage` is the sum of the subagent's replies (for
budgets; the host already accounted each request). Its transcript events go only to the `onEvent`
the host returned; `onSessionCreated` receives its session before its first request. Its session id
is `<parent session id>/<call id>`. Subagent calls of one step run at the same time, and a subagent
has no `subagent` tool of its own.
```

在 `## Extensions` 一节末尾、`ASK_USER_TOOL_NAME` 那段之后加一句宿主须知：

```markdown
The approval layer may auto-allow `subagent`: each call the subagent makes is approved on its own.
```

- [ ] **Step 9: 门禁**

```bash
pnpm --filter @cherrystudio/agent-runtime typecheck
pnpm exec oxlint --deny-warnings packages/agent-runtime-pi/src/subagent.ts packages/agent-runtime-pi/src/session.ts packages/agent-runtime-pi/src/index.ts packages/agent-runtime-pi/tests/subagentSupport.ts packages/agent-runtime-pi/tests/subagent.test.ts
pnpm exec eslint packages/agent-runtime-pi/src/subagent.ts packages/agent-runtime-pi/src/session.ts packages/agent-runtime-pi/src/index.ts packages/agent-runtime-pi/tests/subagentSupport.ts packages/agent-runtime-pi/tests/subagent.test.ts
pnpm exec oxfmt --write packages/agent-runtime-pi/src/subagent.ts packages/agent-runtime-pi/src/session.ts packages/agent-runtime-pi/src/index.ts packages/agent-runtime-pi/tests/subagentSupport.ts packages/agent-runtime-pi/tests/subagent.test.ts packages/agent-runtime-pi/README.md
pnpm exec vitest run --project agent-runtime packages/agent-runtime-pi/tests/session.test.ts packages/agent-runtime-pi/tests/transcript.test.ts
```

Expected: 全部通过；后两个是 `session.ts` 的已有消费者。

- [ ] **Step 10: Commit**

```bash
git add packages/agent-runtime-pi/src/subagent.ts packages/agent-runtime-pi/src/session.ts packages/agent-runtime-pi/src/index.ts packages/agent-runtime-pi/README.md packages/agent-runtime-pi/tests/subagentSupport.ts packages/agent-runtime-pi/tests/subagent.test.ts
git commit -S --signoff -m "feat(agent-runtime): run fresh subagents through a subagent tool"
```

---

### Task 2: 子代理来源与 `AskUserQuestion`

**Files:**
- Modify: `packages/agent-runtime-pi/src/subagent.ts`
- Modify: `packages/agent-runtime-pi/src/askUserExtension.ts:168-178`
- Modify: `packages/agent-runtime-pi/README.md`
- Test: `packages/agent-runtime-pi/tests/subagent.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `Subagent`、`subagentExtension`。
- Produces：
  - `SUBAGENT_ORIGIN_STATE = 'cherry.subagent-origin'`（包内，不从 index 导出）
  - `function isSubagentSession(entries: readonly SessionEntry[]): boolean`（包内；任务 3 和 L5 goal 用）
  - 子会话初始 transcript 末尾总有一条 `cherry.subagent-origin` 状态条目

- [ ] **Step 1: 写失败的测试**

在 `tests/subagent.test.ts` 的 import 里加 `type AskUserPort, createAskUserExtension`（从 `'../src'`），在 `describe` 末尾加：

```ts
  it('answers AskUserQuestion inside a subagent as unavailable without asking the host', async () => {
    const asked: unknown[] = []
    const askPort: AskUserPort = {
      async ask(request) {
        asked.push(request)
        return { status: 'answered', answers: {} }
      }
    }
    const question = {
      questions: [
        {
          question: 'Which file?',
          header: 'File',
          options: [
            { label: 'a.ts', description: 'File A' },
            { label: 'b.ts', description: 'File B' }
          ],
          multiSelect: false
        }
      ]
    }
    const { model, calls } = routedModel(({ userText, lastRole }) => {
      if (userText.includes('TASK-A'))
        return lastRole === 'user'
          ? [toolCallPart('ask_1', 'AskUserQuestion', question), finish('tool-calls')]
          : [...textParts('r', 'REPORT-A'), finish('stop')]
      return lastRole === 'user'
        ? [subagentCall('call_a', TASK_A), finish('tool-calls')]
        : [...textParts('d', 'Done'), finish('stop')]
    })
    const host = recordingSubagentPort(() => ({ extensionFactories: [createAskUserExtension(askPort)] }))
    const { session } = await createTestSession({
      port: streamTextPort(model).port,
      subagents: host.port,
      extensionFactories: [createAskUserExtension(askPort)]
    })

    await session.prompt(DELEGATE_A)

    expect(asked).toEqual([])
    const [answer] = toolResults(calls.filter((call) => call.userText.includes('TASK-A'))[1])
    expect(answer.output.type).toBe('error-text')
    expect(outputText(answer.output)).toMatch(/No one can answer/)
  })
```

在什么情况下失败：子代理里的 `AskUserQuestion` 仍去问宿主（`asked` 非空），或者识别失效返回了别的结果。父会话里 `AskUserQuestion` 照常询问由已有的 `tests/askUser.test.ts` 保证：识别若误判，那里会失败。

- [ ] **Step 2: 运行测试，确认失败**

Run: `pnpm exec vitest run --project agent-runtime packages/agent-runtime-pi/tests/subagent.test.ts -t "unavailable"`
Expected: FAIL，`asked` 里有一次请求。

- [ ] **Step 3: 在 `src/subagent.ts` 加来源条目与识别**

import 改为：

```ts
import type { AgentSession, AgentToolResult, ExtensionFactory, SessionEntry } from '@earendil-works/pi-coding-agent'

import type { AgentRuntimeSession } from './session'
import type { TranscriptEntry, TranscriptStateEntry } from './transcript'
import type { AgentRuntimeEvent } from './transcriptTap'
```

在 `SUBAGENT_TOOL_NAME` 之后加：

```ts
/** State entry naming the call that created a session; it marks a subagent's session. */
export const SUBAGENT_ORIGIN_STATE = 'cherry.subagent-origin'

/** True inside a subagent's session. */
export function isSubagentSession(entries: readonly SessionEntry[]): boolean {
  return entries.some((entry) => entry.type === 'custom' && entry.customType === SUBAGENT_ORIGIN_STATE)
}

const originEntry = (subagent: Subagent): TranscriptStateEntry => ({
  id: `subagent-origin-${subagent.parentToolCallId}`,
  timestamp: Date.now(),
  kind: 'state',
  type: SUBAGENT_ORIGIN_STATE,
  data: { parentToolCallId: subagent.parentToolCallId, fork: subagent.fork }
})
```

`execute` 里 `createSession` 的 `transcript: []` 改为 `transcript: [originEntry(subagent)]`。

- [ ] **Step 4: 在 `src/askUserExtension.ts` 用识别**

import 区加：

```ts
import { isSubagentSession } from './subagent'
```

`execute` 改为接收 `ctx`，并在两条校验之后加判断：

```ts
      async execute(toolCallId, params, signal, _onUpdate, ctx) {
        const questions = params.questions.map((item) => ({ ...item, multiSelect: item.multiSelect ?? false }))
        const texts = new Set(questions.map((item) => item.question))
        // Answers are keyed by question text and name the chosen labels.
        if (texts.size !== questions.length) throw new Error('Each question must have a different question text.')
        if (questions.some(({ options }) => new Set(options.map((option) => option.label)).size !== options.length))
          throw new Error('Each option of a question must have a different label.')
        // A subagent works for another agent; no person is there to answer.
        if (isSubagentSession(ctx.sessionManager.getBranch())) return toToolResult(questions, { status: 'unavailable' })

        const request = { toolCallId, questions, signal: signal ?? new AbortController().signal }
        return toToolResult(questions, await waitForAnswer(port, request))
      }
```

- [ ] **Step 5: 运行测试，确认通过**

Run: `pnpm exec vitest run --project agent-runtime packages/agent-runtime-pi/tests/subagent.test.ts packages/agent-runtime-pi/tests/askUser.test.ts`
Expected: PASS

- [ ] **Step 6: README**

「Subagents」一节末尾加：

```markdown
A subagent's session holds a `cherry.subagent-origin` state entry (`{ parentToolCallId, fork }`),
never sent to the model; `AskUserQuestion` ends there as `unavailable` without asking the port.
```

- [ ] **Step 7: 门禁**

```bash
pnpm --filter @cherrystudio/agent-runtime typecheck
pnpm exec oxlint --deny-warnings packages/agent-runtime-pi/src/subagent.ts packages/agent-runtime-pi/src/askUserExtension.ts packages/agent-runtime-pi/tests/subagent.test.ts
pnpm exec eslint packages/agent-runtime-pi/src/subagent.ts packages/agent-runtime-pi/src/askUserExtension.ts packages/agent-runtime-pi/tests/subagent.test.ts
pnpm exec oxfmt --write packages/agent-runtime-pi/src/subagent.ts packages/agent-runtime-pi/src/askUserExtension.ts packages/agent-runtime-pi/tests/subagent.test.ts packages/agent-runtime-pi/README.md
```

- [ ] **Step 8: Commit**

```bash
git add packages/agent-runtime-pi/src/subagent.ts packages/agent-runtime-pi/src/askUserExtension.ts packages/agent-runtime-pi/README.md packages/agent-runtime-pi/tests/subagent.test.ts
git commit -S --signoff -m "feat(agent-runtime): mark subagent sessions and keep AskUserQuestion away from users there"
```

---

### Task 3: fork 子代理

**Files:**
- Modify: `packages/agent-runtime-pi/src/subagent.ts`
- Modify: `packages/agent-runtime-pi/src/session.ts`（`subagentExtension` 的注册）
- Modify: `packages/agent-runtime-pi/README.md`
- Create: `packages/agent-runtime-pi/tests/subagentFork.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `subagentExtension`、`SubagentSessionOverrides`、`SubagentToolOptions`；Task 2 的 `isSubagentSession`、`originEntry`。
- Produces：
  - `subagent` 参数加 `fork?: boolean`
  - `SubagentSessionOverrides` 加 `fork: boolean`
  - `SubagentToolOptions` 加 `parentTranscript: () => readonly TranscriptEntry[]`
  - 包内 `function forkTranscript(entries: readonly TranscriptEntry[], toolCallId: string): TranscriptEntry[]`
  - 子代理里调用 `subagent` 得到错误结果 `Subagents cannot start subagents.`

- [ ] **Step 1: 写失败的测试 `tests/subagentFork.test.ts`**

```ts
import { Type } from '@earendil-works/pi-ai'
import { createToolSearchExtension, defineTool } from '@earendil-works/pi-coding-agent'
import { describe, expect, it } from 'vitest'

import { createTestSession, finish, hostStore, streamTextPort, textParts } from './support'
import {
  noteTool,
  outputText,
  recordingSubagentPort,
  routedModel,
  subagentCall,
  toolCallPart,
  toolResults
} from './subagentSupport'

const forkA = { description: 'Check A', prompt: 'TASK-A', fork: true }
const forkB = { description: 'Check B', prompt: 'TASK-B', fork: true }

describe('subagent fork', () => {
  it('starts each fork from the parent conversation up to its call, every call of that step answered by one placeholder', async () => {
    const { model, calls } = routedModel(({ userText, lastRole }) => {
      for (const task of ['TASK-A', 'TASK-B'])
        if (userText.includes(task)) return [...textParts('r', `REPORT ${task}`), finish('stop')]
      return lastRole === 'user'
        ? [toolCallPart('note_1', 'note'), subagentCall('call_a', forkA), subagentCall('call_b', forkB), finish('tool-calls')]
        : [...textParts('d', 'Done'), finish('stop')]
    })
    const { session } = await createTestSession({
      port: streamTextPort(model).port,
      tools: [noteTool],
      subagents: recordingSubagentPort().port
    })

    await session.prompt('Check modules A and B')

    const promptA = calls.find((call) => call.userText.includes('TASK-A'))!.options.prompt
    const promptB = calls.find((call) => call.userText.includes('TASK-B'))!.options.prompt
    const parentAfterTools = calls.at(-1)!.options.prompt
    expect(parentAfterTools.slice(0, 3).map((message) => message.role)).toEqual(['system', 'user', 'assistant'])
    expect(promptA.slice(0, 3)).toEqual(parentAfterTools.slice(0, 3))
    expect(promptA.slice(0, -1)).toEqual(promptB.slice(0, -1))
    expect(promptA.at(-1)).not.toEqual(promptB.at(-1))
    const placeholders = promptA
      .flatMap((message) => (message.role === 'tool' ? message.content : []))
      .flatMap((part) => (part.type === 'tool-result' ? [part] : []))
    expect(placeholders.map((part) => part.toolCallId)).toEqual(['note_1', 'call_a', 'call_b'])
    expect(new Set(placeholders.map((part) => JSON.stringify(part.output))).size).toBe(1)
    expect(JSON.stringify(placeholders)).not.toContain('noted')
  })

  it('gives a fork the tools of the parent, including tools that tool_search activated', async () => {
    const weather = defineTool({
      name: 'get_weather',
      label: 'Weather',
      description: 'Get the weather forecast for a city',
      parameters: Type.Object({ city: Type.String() }),
      exposure: 'deferred',
      async execute() {
        return { content: [{ type: 'text', text: 'Sunny' }], details: undefined }
      }
    })
    const { model, calls } = routedModel(({ userText, lastRole }) => {
      if (userText.includes('TASK-A')) return [...textParts('r', 'REPORT-A'), finish('stop')]
      if (userText.includes('Delegate'))
        return lastRole === 'user'
          ? [subagentCall('call_a', forkA), finish('tool-calls')]
          : [...textParts('d', 'Done'), finish('stop')]
      return lastRole === 'user'
        ? [toolCallPart('search_1', 'tool_search', { query: 'weather forecast' }), finish('tool-calls')]
        : [...textParts('l', 'Loaded.'), finish('stop')]
    })
    const { session } = await createTestSession({
      port: streamTextPort(model).port,
      tools: [weather],
      builtinTools: ['tool_search'],
      extensionFactories: [createToolSearchExtension()],
      subagents: recordingSubagentPort(() => ({ extensionFactories: [createToolSearchExtension()] })).port
    })

    await session.prompt('Find a weather tool')
    await session.prompt('Delegate the forecast check')

    const parentCall = calls.find((call) => call.userText.includes('Delegate') && call.lastRole === 'user')!
    const forkCall = calls.find((call) => call.userText.includes('TASK-A'))!
    const names = (call: typeof forkCall) => call.options.tools?.map((tool) => tool.name)
    expect(names(forkCall)).toEqual(names(parentCall))
    expect(names(forkCall)).toEqual(expect.arrayContaining(['get_weather', 'subagent']))
  })

  it('rejects a subagent call made inside a fork', async () => {
    const { model, calls } = routedModel(({ userText, lastRole }) => {
      if (userText.includes('TASK-A'))
        return lastRole === 'user'
          ? [subagentCall('call_nested', { description: 'Nested', prompt: 'TASK-NESTED' }), finish('tool-calls')]
          : [...textParts('r', 'REPORT-A'), finish('stop')]
      return lastRole === 'user'
        ? [subagentCall('call_a', forkA), finish('tool-calls')]
        : [...textParts('d', 'Done'), finish('stop')]
    })
    const host = recordingSubagentPort()
    const { session } = await createTestSession({ port: streamTextPort(model).port, subagents: host.port })

    await session.prompt('Check module A')

    expect(host.subagents.map((subagent) => subagent.parentToolCallId)).toEqual(['call_a'])
    const nested = toolResults(calls.filter((call) => call.userText.includes('TASK-A'))[1]).at(-1)!
    expect(nested.toolCallId).toBe('call_nested')
    expect(outputText(nested.output)).toMatch(/cannot start subagents/)
  })

  it('forks a session rebuilt from the host transcript with the replayed history', async () => {
    const earlier = routedModel(() => [...textParts('a', 'Noted.'), finish('stop')])
    const host = hostStore()
    const first = await createTestSession({ port: streamTextPort(earlier.model).port, onEvent: host.onEvent })
    await first.session.prompt('Remember the codename ORCHID')

    const { model, calls } = routedModel(({ userText, lastRole }) => {
      if (userText.includes('TASK-A')) return [...textParts('r', 'REPORT-A'), finish('stop')]
      return lastRole === 'user'
        ? [subagentCall('call_a', forkA), finish('tool-calls')]
        : [...textParts('d', 'Done'), finish('stop')]
    })
    const { session } = await createTestSession({
      port: streamTextPort(model).port,
      transcript: host.entries,
      subagents: recordingSubagentPort().port
    })
    await session.prompt('Delegate the check')

    expect(calls.find((call) => call.userText.includes('TASK-A'))!.userText).toContain('ORCHID')
  })
})
```

各测试在什么情况下失败：截断位置错、混入真实结果或占位文本不一致（第 1 条）；fork 的工具列表或顺序与父会话不同（第 2 条）；fork 里还能再派子代理（第 3 条）；fork 只取了本次会话新增的条目、丢了重放的历史（第 4 条）。

- [ ] **Step 2: 运行测试，确认失败**

Run: `pnpm exec vitest run --project agent-runtime packages/agent-runtime-pi/tests/subagentFork.test.ts`
Expected: FAIL，`fork` 参数不被接受，fork 子代理的请求里没有父会话历史。

- [ ] **Step 3: 在 `src/subagent.ts` 实现 fork**

import 区加：

```ts
import type { ToolCallPart } from 'ai'

import type { TranscriptEntry, TranscriptMessageEntry, TranscriptStateEntry } from './transcript'
```

（`TranscriptEntry`、`TranscriptStateEntry` 已有，合并到同一条 import。）

`SubagentSessionOverrides` 加字段：

```ts
  /** A fork keeps `subagent` registered so its tools match the parent's. */
  fork: boolean
```

`SubagentToolOptions` 加字段：

```ts
  /** The parent's transcript so far, including the running turn. */
  parentTranscript: () => readonly TranscriptEntry[]
```

`DESCRIPTION` 整体换成：

```ts
const DESCRIPTION = [
  'Delegate a task to a subagent: a separate agent with the same tools that returns only its final report, so the work does not fill this conversation.',
  '- By default the subagent starts with an empty context: put everything it needs in the prompt.',
  '- With fork: true it starts from this conversation as it is now, so the prompt needs only what is new.',
  '- Start independent subagents together in one message; they run at the same time.',
  '- You see the final report, not the intermediate steps.'
].join('\n')
```

`parameters` 换成：

```ts
const parameters = Type.Object({
  description: Type.String({ description: 'A short (3-5 word) title of the task, shown to the user.' }),
  prompt: Type.String({ description: 'The task for the subagent.' }),
  fork: Type.Optional(
    Type.Boolean({
      description: 'Start from this conversation as it is now instead of an empty context. Default false.'
    })
  )
})
```

在 `originEntry` 之后加：

```ts
const PLACEHOLDER = 'This tool call was still running when the subagent started; its result is not available here.'

function toolCallsOf(entry: TranscriptEntry): ToolCallPart[] {
  if (entry.kind !== 'message' || entry.message.role !== 'assistant' || typeof entry.message.content === 'string')
    return []
  return entry.message.content.filter((part): part is ToolCallPart => part.type === 'tool-call')
}

/**
 * The parent's transcript up to the assistant message holding `toolCallId`, every call of that
 * message answered by the same placeholder, so sibling forks send the same prefix.
 */
function forkTranscript(entries: readonly TranscriptEntry[], toolCallId: string): TranscriptEntry[] {
  const index = entries.findIndex((entry) => toolCallsOf(entry).some((call) => call.toolCallId === toolCallId))
  if (index < 0) throw new Error(`No assistant message holds the call ${toolCallId}.`)
  const assistant = entries[index]
  const placeholders = toolCallsOf(assistant).map(
    (call, i): TranscriptMessageEntry => ({
      id: `${assistant.id}-fork-${i}`,
      timestamp: assistant.timestamp,
      kind: 'message',
      message: {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: call.toolCallId,
            toolName: call.toolName,
            output: { type: 'text', value: PLACEHOLDER }
          }
        ]
      }
    })
  )
  return [...entries.slice(0, index + 1), ...placeholders]
}
```

`subagentExtension` 的签名改为 `({ port, createSession, parentTranscript }: SubagentToolOptions)`，`execute` 整体换成：

```ts
      async execute(toolCallId, params, _signal, _onUpdate, ctx) {
        if (isSubagentSession(ctx.sessionManager.getBranch())) throw new Error('Subagents cannot start subagents.')
        const description = params.description.trim()
        const prompt = params.prompt.trim()
        if (!description || !prompt) throw new Error('A subagent needs a non-empty description and prompt.')
        const fork = params.fork ?? false
        const subagent: Subagent = {
          parentToolCallId: toolCallId,
          sessionId: `${ctx.sessionManager.getSessionId()}/${toolCallId}`,
          fork
        }
        const options = await port.configure(subagent)
        const transcript = [...(fork ? forkTranscript(parentTranscript(), toolCallId) : []), originEntry(subagent)]
        const child = await createSession({
          sessionId: subagent.sessionId,
          transcript,
          fork,
          extensionFactories: options.extensionFactories ?? [],
          onEvent: options.onEvent
        })
        try {
          options.onSessionCreated?.(child.session)
          return await run(child, prompt, { sessionId: subagent.sessionId, fork })
        } finally {
          await child.dispose()
        }
      }
```

- [ ] **Step 4: 在 `src/session.ts` 改注册**

把 Task 1 加的那段换成：

```ts
    ...(options.subagents
      ? [
          subagentExtension({
            port: options.subagents,
            // A fork keeps `subagent` so its tools match the parent's; a fresh subagent has none.
            createSession: ({ fork, ...overrides }) =>
              createAgentRuntimeSession({ ...options, ...overrides, subagents: fork ? options.subagents : undefined }),
            parentTranscript: () => tap.entries()
          })
        ]
      : []),
```

- [ ] **Step 5: 运行测试，确认通过**

Run: `pnpm exec vitest run --project agent-runtime packages/agent-runtime-pi/tests/subagentFork.test.ts packages/agent-runtime-pi/tests/subagent.test.ts`
Expected: PASS

如果第 2 条只在工具顺序上失败：父会话里 `tool_search` 激活的工具排在 Pi 自己决定的位置，而子会话由 `session.ts` 的 `setActiveToolsByName([...baseTools, ...rebuilt.activatedTools])` 排序。先打印两边的 `tools` 名单确认差异在哪，再让重建时的顺序与 Pi 激活时的顺序一致；不要改测试去忽略顺序，顺序不同会让 fork 的缓存失效（spec §4.2）。

- [ ] **Step 6: README**

把「Subagents」一节第一句的 `subagent({ description, prompt })` 改成 `subagent({ description, prompt, fork? })`，并在该节末尾加：

```markdown
`fork: true` starts the subagent from the parent's transcript up to the assistant message holding the
call, every call of that message answered by the same placeholder, so forks of one step send the same
prefix and can share the prompt cache. A fork keeps the parent's tools, `subagent` included, and the
host must return the parent's extensions for it; calls a subagent may not make (another `subagent`,
`AskUserQuestion`) fail or end as `unavailable` instead of being removed.
```

`## Known gaps` 加一条：

```markdown
- A fork's requests carry the subagent's session id, so a host that routes prompt caches by session id
  (OpenAI's `prompt_cache_key`) does not reach the parent's cache partition.
```

- [ ] **Step 7: 门禁**

```bash
pnpm --filter @cherrystudio/agent-runtime typecheck
pnpm exec oxlint --deny-warnings packages/agent-runtime-pi/src/subagent.ts packages/agent-runtime-pi/src/session.ts packages/agent-runtime-pi/tests/subagentFork.test.ts
pnpm exec eslint packages/agent-runtime-pi/src/subagent.ts packages/agent-runtime-pi/src/session.ts packages/agent-runtime-pi/tests/subagentFork.test.ts
pnpm exec oxfmt --write packages/agent-runtime-pi/src/subagent.ts packages/agent-runtime-pi/src/session.ts packages/agent-runtime-pi/tests/subagentFork.test.ts packages/agent-runtime-pi/README.md
pnpm exec vitest run --project agent-runtime packages/agent-runtime-pi/tests/session.test.ts packages/agent-runtime-pi/tests/transcript.test.ts
```

- [ ] **Step 8: Commit**

```bash
git add packages/agent-runtime-pi/src/subagent.ts packages/agent-runtime-pi/src/session.ts packages/agent-runtime-pi/README.md packages/agent-runtime-pi/tests/subagentFork.test.ts
git commit -S --signoff -m "feat(agent-runtime): fork subagents from the parent conversation with a shared prefix"
```

---

### Task 4: 失败、中止与请求上限

**Files:**
- Modify: `packages/agent-runtime-pi/src/subagent.ts`（`run`、`execute`）
- Modify: `packages/agent-runtime-pi/src/aiSdkProvider.ts:158-162`
- Modify: `packages/agent-runtime-pi/README.md`
- Create: `packages/agent-runtime-pi/tests/subagentStops.test.ts`
- Modify: `packages/agent-runtime-pi/tests/bridge.test.ts`

**Interfaces:**
- Consumes: Task 3 的 `subagentExtension`、`run`。
- Produces：
  - 包内 `MAX_SUBAGENT_REQUESTS = 200`
  - `run(child, prompt, signal: AbortSignal | undefined, base)`：按 spec §6 的表给 `outcome`，失败时带原因和部分输出
  - 桥接层：信号已中止的请求不再调用 port

- [ ] **Step 1: 写失败的测试 `tests/subagentStops.test.ts`**

```ts
import type { LanguageModelV3StreamPart } from '@ai-sdk/provider'
import { Type } from '@earendil-works/pi-ai'
import { type AgentSession, defineTool } from '@earendil-works/pi-coding-agent'
import { describe, expect, it } from 'vitest'

import type { SubagentPort } from '../src'
import { createTestSession, finish, lastAssistant, streamTextPort, textParts } from './support'
import {
  noteTool,
  outputText,
  recordingSubagentPort,
  routedModel,
  subagentCall,
  toolCallPart,
  toolResultOf,
  toolResults
} from './subagentSupport'

const TASK_A = { description: 'Check A', prompt: 'TASK-A' }
const upstreamError = { type: 'error' as const, error: new Error('upstream exploded') }

/** Parent delegates TASK-A once; `child` scripts the subagent. */
function delegate(child: (lastRole: string) => LanguageModelV3StreamPart[]) {
  return routedModel(({ userText, lastRole }) => {
    if (userText.includes('TASK-A')) return child(lastRole)
    return lastRole === 'user'
      ? [subagentCall('call_a', TASK_A), finish('tool-calls')]
      : [...textParts('d', 'Done'), finish('stop')]
  })
}

describe('subagent stops', () => {
  it('reports a failed subagent as an error with its partial output and usage', async () => {
    const { model } = delegate((lastRole) =>
      lastRole === 'user'
        ? [...textParts('p', 'PARTIAL-A'), toolCallPart('note_1', 'note'), finish('tool-calls', 100, 20)]
        : [upstreamError]
    )
    const { session } = await createTestSession({
      port: streamTextPort(model).port,
      tools: [noteTool],
      subagents: recordingSubagentPort().port
    })

    await session.prompt('Delegate the check')

    const result = toolResultOf(session, 'call_a')
    expect(result.isError).toBe(true)
    expect(result.details).toMatchObject({ outcome: 'failed' })
    const message = result.content.map((block) => (block.type === 'text' ? block.text : '')).join('')
    expect(message).toContain('upstream exploded')
    expect(message).toContain('PARTIAL-A')
    expect(result.usage?.totalTokens).toBe(122)
  })

  it('reports a subagent cut off by its output limit as truncated', async () => {
    const { model } = delegate(() => [...textParts('h', 'HALF-A'), finish('length')])
    const { session } = await createTestSession({
      port: streamTextPort(model).port,
      subagents: recordingSubagentPort().port
    })

    await session.prompt('Delegate the check')

    const result = toolResultOf(session, 'call_a')
    expect(result.isError).toBe(true)
    expect(result.details).toMatchObject({ outcome: 'truncated' })
    expect(result.content.map((block) => (block.type === 'text' ? block.text : '')).join('')).toContain('HALF-A')
  })

  it('returns the report of one subagent when its sibling fails', async () => {
    const { model, calls } = routedModel(({ userText, lastRole }) => {
      if (userText.includes('TASK-A')) return [upstreamError]
      if (userText.includes('TASK-B')) return [...textParts('r', 'REPORT-B'), finish('stop')]
      return lastRole === 'user'
        ? [
            subagentCall('call_a', TASK_A),
            subagentCall('call_b', { description: 'Check B', prompt: 'TASK-B' }),
            finish('tool-calls')
          ]
        : [...textParts('d', 'Done'), finish('stop')]
    })
    const { session } = await createTestSession({
      port: streamTextPort(model).port,
      subagents: recordingSubagentPort().port
    })

    await session.prompt('Check modules A and B')

    const [a, b] = toolResults(calls.at(-1)!)
    expect(a.output.type).toBe('error-text')
    expect(outputText(b.output)).toBe('REPORT-B')
  })

  it('stops the subagent and shuts it down when the parent turn aborts', async () => {
    const parent: { session?: AgentSession } = {}
    let shutdowns = 0
    const waitTool = defineTool({
      name: 'wait',
      label: 'Wait',
      description: 'Wait until stopped',
      parameters: Type.Object({}),
      async execute(_id, _params, signal) {
        void parent.session!.abort()
        await new Promise<void>((resolve) => {
          if (signal?.aborted) resolve()
          else signal?.addEventListener('abort', () => resolve(), { once: true })
        })
        return { content: [{ type: 'text', text: 'stopped' }], details: undefined }
      }
    })
    const { model, calls } = delegate((lastRole) =>
      lastRole === 'user' ? [toolCallPart('wait_1', 'wait'), finish('tool-calls')] : [...textParts('r', 'LATE'), finish('stop')]
    )
    const host = recordingSubagentPort(() => ({
      extensionFactories: [(pi) => pi.on('session_shutdown', () => void shutdowns++)]
    }))
    const runtime = await createTestSession({
      port: streamTextPort(model).port,
      tools: [waitTool],
      subagents: host.port
    })
    parent.session = runtime.session

    await runtime.session.prompt('Delegate the check')

    expect(shutdowns).toBe(1)
    expect(calls.filter((call) => call.userText.includes('TASK-A'))).toHaveLength(1)
    const childEvents = host.events.get(`${runtime.session.sessionId}/call_a`)!
    expect(childEvents.at(-1)).toMatchObject({ type: 'turn-complete', aborted: true })
  })

  it('does not start a subagent when the turn aborts before the host finishes configuring it', async () => {
    const parent: { session?: AgentSession } = {}
    const { model, calls } = delegate(() => [...textParts('r', 'REPORT-A'), finish('stop')])
    const host = recordingSubagentPort(async () => {
      void parent.session!.abort()
      await new Promise((resolve) => setTimeout(resolve, 0))
      return {}
    })
    const runtime = await createTestSession({ port: streamTextPort(model).port, subagents: host.port })
    parent.session = runtime.session

    await runtime.session.prompt('Delegate the check')

    expect(calls.filter((call) => call.userText.includes('TASK-A'))).toHaveLength(0)
    expect(host.sessions.size).toBe(0)
  })

  it('fails the call when the host cannot configure the subagent, and the parent continues', async () => {
    const port: SubagentPort = {
      configure() {
        throw new Error('no workspace for subagents')
      }
    }
    const { model, calls } = delegate(() => [...textParts('r', 'REPORT-A'), finish('stop')])
    const { session } = await createTestSession({ port: streamTextPort(model).port, subagents: port })

    await session.prompt('Delegate the check')

    const [result] = toolResults(calls.at(-1)!)
    expect(result.output.type).toBe('error-text')
    expect(outputText(result.output)).toContain('no workspace for subagents')
    expect(lastAssistant(session).stopReason).toBe('stop')
  })

  it('stops a subagent after 200 model requests', { timeout: 60_000 }, async () => {
    let next = 0
    const { model, calls } = delegate(() => [toolCallPart(`note_${++next}`, 'note'), finish('tool-calls')])
    const { session } = await createTestSession({
      port: streamTextPort(model).port,
      tools: [noteTool],
      subagents: recordingSubagentPort().port
    })

    await session.prompt('Delegate the check')

    expect(calls.filter((call) => call.userText.includes('TASK-A'))).toHaveLength(200)
    const result = toolResultOf(session, 'call_a')
    expect(result.isError).toBe(true)
    expect(result.details).toMatchObject({ outcome: 'limit_reached' })
  })
})
```

各测试在什么情况下失败：失败被当成成功、丢了部分输出或用量（第 1 条）；`length` 被当成成功（第 2 条）；一个子代理失败拖垮兄弟（第 3 条）；父会话中止后子代理继续请求或没被 dispose（第 4 条）；中止后仍建子会话（第 5 条）；宿主错误击穿父会话（第 6 条）；没有请求上限或上限后多发请求（第 7 条）。

- [ ] **Step 2: 在 `tests/bridge.test.ts` 加桥接测试**

在 `'settles a call the host aborts through its own signal as aborted, not as a failure'` 之后加：

```ts
  it('does not call the port for a request whose signal is already aborted', async () => {
    const { model, calls } = scriptedModel([[...textParts('t', 'never sent'), finish('stop')]])
    const { session } = await createTestSession({
      port: streamTextPort(model).port,
      extensionFactories: [(pi) => pi.on('before_provider_request', (_event, ctx) => ctx.abort())]
    })

    await session.prompt('Hello')

    expect(calls).toHaveLength(0)
    expect(lastAssistant(session).stopReason).toBe('aborted')
  })
```

在什么情况下失败：桥接层把已经中止的请求仍交给宿主（宿主白白发起一次模型调用）。Pi 在两次请求之间不检查中止信号，第 7 条的上限要靠这条保证。

- [ ] **Step 3: 运行测试，确认失败**

Run: `pnpm exec vitest run --project agent-runtime packages/agent-runtime-pi/tests/subagentStops.test.ts packages/agent-runtime-pi/tests/bridge.test.ts`
Expected: FAIL，至少第 2、4、5、7 条和桥接测试失败。

- [ ] **Step 4: 桥接层守卫（`src/aiSdkProvider.ts`）**

在 `const replaced = await options?.onPayload?.(request, model)` 那两行之后、`const result = await provider.port.streamText(request)` 之前加：

```ts
      // Pi may start one more request after an abort; never hand the host a request already cancelled.
      if (signal?.aborted) throw new Error('Model call was aborted')
```

- [ ] **Step 5: 在 `src/subagent.ts` 实现结果分类、中止和上限**

在 `NO_FINAL_MESSAGE` 之后加：

```ts
/** Model requests one subagent may make before it is stopped (Claude Code's limit for a fork). */
export const MAX_SUBAGENT_REQUESTS = 200

const STOPPED: Record<Exclude<SubagentDetails['outcome'], 'completed'>, string> = {
  failed: 'The subagent failed',
  truncated: 'The subagent hit its output limit before finishing',
  aborted: 'The subagent was stopped because the turn was aborted',
  limit_reached: `The subagent was stopped after ${MAX_SUBAGENT_REQUESTS} model requests`
}

function outcomeOf(
  last: AssistantMessage | undefined,
  stopped: 'aborted' | 'limit_reached' | undefined
): SubagentDetails['outcome'] {
  if (stopped) return stopped
  switch (last?.stopReason) {
    case 'stop':
      return 'completed'
    case 'length':
      return 'truncated'
    case 'aborted':
      return 'aborted'
    default:
      return 'failed'
  }
}

const textOf = (message: AssistantMessage) =>
  message.content.map((block) => (block.type === 'text' ? block.text : '')).join('')

const notStarted = (base: Omit<SubagentDetails, 'outcome'>): AgentToolResult<SubagentDetails> => ({
  content: [text('The subagent was not started because the turn was aborted.')],
  details: { ...base, outcome: 'aborted' },
  isError: true
})
```

`@earendil-works/pi-ai` 的 import 改为 `import { type AssistantMessage, Type, type Usage } from '@earendil-works/pi-ai'`。

`run` 整体换成：

```ts
/** Runs the task to settlement; the result carries the subagent's final message and the sum of its usage. */
async function run(
  child: AgentRuntimeSession,
  prompt: string,
  signal: AbortSignal | undefined,
  base: Omit<SubagentDetails, 'outcome'>
): Promise<AgentToolResult<SubagentDetails>> {
  const { session } = child
  const start = session.messages.length
  let stopped: 'aborted' | 'limit_reached' | undefined
  const stop = (reason: 'aborted' | 'limit_reached') => {
    stopped ??= reason
    void session.abort()
  }
  let requests = 0
  const unsubscribe = session.subscribe((event) => {
    // A turn with tool results leads to another request; stop before it.
    if (event.type === 'turn_end' && ++requests >= MAX_SUBAGENT_REQUESTS && event.toolResults.length > 0)
      stop('limit_reached')
  })
  const onAbort = () => stop('aborted')
  signal?.addEventListener('abort', onAbort, { once: true })
  let error: string | undefined
  try {
    if (signal?.aborted) stop('aborted')
    else await session.prompt(taskText(prompt), { expandPromptTemplates: false, source: 'extension' })
  } catch (thrown) {
    error = thrown instanceof Error ? thrown.message : String(thrown)
  } finally {
    unsubscribe()
    signal?.removeEventListener('abort', onAbort)
  }

  const replies = session.messages.slice(start).filter((message) => message.role === 'assistant')
  const usage = replies.reduce((sum, reply) => addUsage(sum, reply.usage), zeroUsage())
  const last = replies.at(-1)
  const outcome = error === undefined ? outcomeOf(last, stopped) : (stopped ?? 'failed')
  const details = { ...base, outcome }
  if (outcome === 'completed') return { content: [text(textOf(last!).trim() || NO_FINAL_MESSAGE)], details, usage }

  const reason = error ?? (outcome === 'failed' ? last?.errorMessage : undefined)
  const partial = replies.map(textOf).filter((part) => part.trim()).at(-1)
  const lines = [reason ? `${STOPPED[outcome]}: ${reason}` : `${STOPPED[outcome]}.`]
  if (partial) lines.push(`Partial output before it stopped:\n${partial}`)
  return { content: [text(lines.join('\n'))], details, usage, isError: true }
}
```

`execute` 里：参数 `_signal` 改名为 `signal`；`const options = await port.configure(subagent)` 之后加：

```ts
        const base = { sessionId: subagent.sessionId, fork }
        if (signal?.aborted) return notStarted(base)
```

并把 `return await run(child, prompt, { sessionId: subagent.sessionId, fork })` 改为 `return await run(child, prompt, signal, base)`。

- [ ] **Step 6: 运行测试，确认通过**

Run: `pnpm exec vitest run --project agent-runtime packages/agent-runtime-pi/tests/subagentStops.test.ts packages/agent-runtime-pi/tests/bridge.test.ts packages/agent-runtime-pi/tests/subagent.test.ts packages/agent-runtime-pi/tests/subagentFork.test.ts`
Expected: PASS

- [ ] **Step 7: README**

「Subagents」一节末尾加：

```markdown
A subagent that fails, is cut off by its output limit, is aborted with the parent's turn or reaches
200 model requests returns an `isError` result with the reason, its last partial output, `details`
and `usage`; `outcome` is `failed`, `truncated`, `aborted` or `limit_reached`. A host whose
`configure` throws fails that call only. The bridge never hands the port a request whose signal is
already aborted.
```

- [ ] **Step 8: 门禁**

```bash
pnpm --filter @cherrystudio/agent-runtime typecheck
pnpm exec oxlint --deny-warnings packages/agent-runtime-pi/src/subagent.ts packages/agent-runtime-pi/src/aiSdkProvider.ts packages/agent-runtime-pi/tests/subagentStops.test.ts packages/agent-runtime-pi/tests/bridge.test.ts
pnpm exec eslint packages/agent-runtime-pi/src/subagent.ts packages/agent-runtime-pi/src/aiSdkProvider.ts packages/agent-runtime-pi/tests/subagentStops.test.ts packages/agent-runtime-pi/tests/bridge.test.ts
pnpm exec oxfmt --write packages/agent-runtime-pi/src/subagent.ts packages/agent-runtime-pi/src/aiSdkProvider.ts packages/agent-runtime-pi/tests/subagentStops.test.ts packages/agent-runtime-pi/tests/bridge.test.ts packages/agent-runtime-pi/README.md
pnpm test:agent-runtime
```

`pnpm test:agent-runtime` 跑的是本包自己的 Vitest 项目，桥接层改动影响包内全部会话，所以这里跑整个包。

- [ ] **Step 9: Commit**

```bash
git add packages/agent-runtime-pi/src/subagent.ts packages/agent-runtime-pi/src/aiSdkProvider.ts packages/agent-runtime-pi/README.md packages/agent-runtime-pi/tests/subagentStops.test.ts packages/agent-runtime-pi/tests/bridge.test.ts
git commit -S --signoff -m "feat(agent-runtime): stop subagents on failure, abort and the request limit"
```
