# Agent 子进程回环代理绕过与代理热切换实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 仅在构造 Claude Code Agent 子进程环境时，把精确的 IPv4/IPv6 回环规则合并进 `NO_PROXY`/`no_proxy`，并让 Cherry 代理切换在下一轮新对话前触发旧 Agent 连接重建。

**架构：** 在 `src/main/ai/runtime/claudeCode/` 内新增无状态代理环境模块，集中负责规则解析、去重、回环补全、缓存 Cherry 代理识别和代理环境指纹。`settingsBuilder` 用它生成实际启动环境；`agentSessionWarmup` 用同一指纹函数描述连接的 spawn-frozen 事实，并在首次连接时从已经物化的 `settings.env` 固化基线，避免启动与签名之间的竞态。

**技术栈：** TypeScript、Vitest 3、Node.js 进程环境变量、Undici/Claude Agent SDK 子进程环境约定。

---

## 范围与已确认约束

- 只修改 Claude Code Agent 域；不修改 Electron/Chromium 全局代理、`NodeProxyController` 或普通聊天网络栈。
- 自动追加的规则严格限定为 `localhost`、`127.0.0.1`、`::1`、`[::1]`，不扩大到 `127.0.0.0/8`、`*.localhost`、私网或链路本地地址。
- 仅在存在非空代理端点变量时补全回环规则。代理变量包括 HTTP、HTTPS、ALL、SOCKS 和 gRPC 的现有大小写形式。
- 按 `no_proxy`、`NO_PROXY` 顺序读取，按 `/[\s,;]+/` 切分；使用规则全文的小写值去重，但保留第一次出现的原始文本。
- `::1` 和 `[::1]` 是两个不同规则，都必须保留；Undici 使用带方括号的 IPv6 host，其他实现可能接受裸地址。
- 如果合并结果包含独立的 `*`，把两种变量都写为 `*`，不再追加回环地址。此时外网直连来自用户明确配置，不属于自动白名单扩大。
- 不终止正在执行的 Agent 轮次。代理变化由下一轮 fresh-turn reconcile 发现；现有后台工作延迟重建机制继续生效。
- 尚未消费的 warm query 已经用完整 `options.env` 校验签名，本改动不改变该机制。
- 登录 shell 缓存中只有与 Cherry 内部代理标记完全一致的代理值会被剔除；与标记不同的用户真实 shell 代理保持原有优先级。
- Agent 自定义代理与 bypass 变量不再重复进入通用 `envVars` 重建事实，由哈希后的 `proxyEnvironment` 独占代理变化归因。

## 文件结构

- 创建 `src/main/ai/runtime/claudeCode/agentProxyEnvironment.ts`：Agent 域代理环境归一化与敏感值指纹。
- 创建 `src/main/ai/runtime/claudeCode/__tests__/agentProxyEnvironment.test.ts`：纯函数的解析、去重、通配符和路由边界回归测试。
- 修改 `src/main/ai/runtime/claudeCode/settingsBuilder.ts`：在所有 Agent 自定义环境变量完成合并后应用回环白名单。
- 修改 `src/main/ai/runtime/claudeCode/__tests__/settingsBuilder.test.ts`：验证真实 Agent settings 输出使用归一化后的两种变量。
- 修改 `src/main/ai/runtime/claudeCode/agentSessionWarmup.ts`：把最终有效代理环境指纹加入连接重建事实，并从物化 settings 固化初始基线。
- 修改 `src/main/ai/runtime/claudeCode/__tests__/agentSessionWarmup.test.ts`：验证 Cherry 代理变化触发签名变化且基线对应实际启动环境。
- 不修改 `src/main/services/proxy/proxyEnv.ts`、`src/main/services/proxy/NodeProxyController.ts`：避免改变普通聊天或 Electron 全局行为。

### 任务 1：用失败测试定义 Agent 代理环境契约

**文件：**

- 创建：`src/main/ai/runtime/claudeCode/__tests__/agentProxyEnvironment.test.ts`
- 创建：`src/main/ai/runtime/claudeCode/agentProxyEnvironment.ts`

- [ ] **步骤 1：创建纯函数测试，覆盖空规则、已有规则、IPv4/IPv6、通配符和外网边界**

先创建测试文件；此时源模块尚不存在，测试应失败：

```ts
import { describe, expect, it } from 'vitest'

import {
  createAgentProxyEnvironmentFingerprint,
  mergeAgentLoopbackProxyBypass
} from '../agentProxyEnvironment'

const PROXY_URL = 'http://remote-proxy.example:7890'

describe('agentProxyEnvironment', () => {
  it('adds exact loopback rules to an active proxy with empty bypass rules', () => {
    const env = mergeAgentLoopbackProxyBypass({ HTTP_PROXY: PROXY_URL })

    expect(env.no_proxy).toBe('localhost,127.0.0.1,::1,[::1]')
    expect(env.NO_PROXY).toBe(env.no_proxy)
  })

  it('merges lowercase before uppercase, accepts common delimiters and preserves first spelling', () => {
    const env = mergeAgentLoopbackProxyBypass({
      HTTPS_PROXY: PROXY_URL,
      no_proxy: 'Example.COM; localhost',
      NO_PROXY: 'example.com 10.0.0.8,::1'
    })

    expect(env.no_proxy).toBe('Example.COM,localhost,10.0.0.8,::1,127.0.0.1,[::1]')
    expect(env.NO_PROXY).toBe(env.no_proxy)
  })

  it('keeps bare and bracketed IPv6 loopback rules as distinct entries', () => {
    const env = mergeAgentLoopbackProxyBypass({ ALL_PROXY: PROXY_URL, no_proxy: '::1' })
    const rules = new Set(env.no_proxy?.split(','))

    expect(rules).toContain('127.0.0.1')
    expect(rules).toContain('::1')
    expect(rules).toContain('[::1]')
  })

  it('collapses an explicit wildcard to both variable forms', () => {
    const env = mergeAgentLoopbackProxyBypass({
      HTTP_PROXY: PROXY_URL,
      no_proxy: 'service.internal',
      NO_PROXY: '*'
    })

    expect(env.no_proxy).toBe('*')
    expect(env.NO_PROXY).toBe('*')
  })

  it('does not rewrite bypass variables when no proxy endpoint is active', () => {
    expect(mergeAgentLoopbackProxyBypass({ NO_PROXY: 'service.internal' })).toEqual({
      NO_PROXY: 'service.internal'
    })
  })

  it('keeps the remote proxy active for external destinations while bypassing only defaults and user rules', () => {
    const env = mergeAgentLoopbackProxyBypass({
      HTTP_PROXY: PROXY_URL,
      HTTPS_PROXY: PROXY_URL,
      no_proxy: 'service.internal'
    })

    expect(env.HTTP_PROXY).toBe(PROXY_URL)
    expect(env.HTTPS_PROXY).toBe(PROXY_URL)
    expect(env.no_proxy).toBe('service.internal,localhost,127.0.0.1,::1,[::1]')
    expect(env.no_proxy).not.toContain('api.minimax.chat')
    expect(env.no_proxy).not.toBe('*')
  })

  it('normalizes delimiter-only differences to the same proxy fingerprint', () => {
    const first = createAgentProxyEnvironmentFingerprint({
      HTTP_PROXY: PROXY_URL,
      no_proxy: 'service.internal; localhost 127.0.0.1 ::1 [::1]'
    })
    const second = createAgentProxyEnvironmentFingerprint({
      HTTP_PROXY: PROXY_URL,
      NO_PROXY: 'service.internal,localhost,127.0.0.1,::1,[::1]'
    })

    expect(second).toBe(first)
    expect(createAgentProxyEnvironmentFingerprint({ HTTP_PROXY: 'http://other-proxy.example:7890' })).not.toBe(
      first
    )
  })
})
```

- [ ] **步骤 2：运行测试，确认因缺少模块而失败**

运行：

```bash
pnpm exec vitest run --project main src/main/ai/runtime/claudeCode/__tests__/agentProxyEnvironment.test.ts
```

预期：FAIL，报告无法解析 `../agentProxyEnvironment`。

- [ ] **步骤 3：实现最小的 Agent 域纯函数**

创建 `src/main/ai/runtime/claudeCode/agentProxyEnvironment.ts`：

```ts
import { createHash } from 'node:crypto'

type AgentEnvironment = Readonly<Record<string, string | undefined>>

const ACTIVE_AGENT_PROXY_ENV_KEYS = [
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'http_proxy',
  'https_proxy',
  'ALL_PROXY',
  'all_proxy',
  'SOCKS_PROXY',
  'socks_proxy',
  'grpc_proxy'
] as const

const AGENT_PROXY_ENV_KEYS = [...ACTIVE_AGENT_PROXY_ENV_KEYS, 'NO_PROXY', 'no_proxy'] as const
const AGENT_LOOPBACK_PROXY_BYPASS_RULES = ['localhost', '127.0.0.1', '::1', '[::1]'] as const

function splitNoProxyRules(value: string | undefined): string[] {
  return value?.split(/[\s,;]+/).filter(Boolean) ?? []
}

function hasActiveProxy(environment: AgentEnvironment): boolean {
  return ACTIVE_AGENT_PROXY_ENV_KEYS.some((key) => {
    const value = environment[key]
    return typeof value === 'string' && value.trim().length > 0
  })
}

export function mergeAgentLoopbackProxyBypass(
  environment: AgentEnvironment
): Record<string, string | undefined> {
  const mergedEnvironment = { ...environment }
  if (!hasActiveProxy(environment)) return mergedEnvironment

  const existingRules = [
    ...splitNoProxyRules(environment.no_proxy),
    ...splitNoProxyRules(environment.NO_PROXY)
  ]
  if (existingRules.includes('*')) {
    mergedEnvironment.no_proxy = '*'
    mergedEnvironment.NO_PROXY = '*'
    return mergedEnvironment
  }

  const seen = new Set<string>()
  const mergedRules: string[] = []
  for (const rule of [...existingRules, ...AGENT_LOOPBACK_PROXY_BYPASS_RULES]) {
    const dedupeKey = rule.toLowerCase()
    if (seen.has(dedupeKey)) continue
    seen.add(dedupeKey)
    mergedRules.push(rule)
  }

  const serializedRules = mergedRules.join(',')
  mergedEnvironment.no_proxy = serializedRules
  mergedEnvironment.NO_PROXY = serializedRules
  return mergedEnvironment
}

export function createAgentProxyEnvironmentFingerprint(environment: AgentEnvironment): string {
  const normalizedEnvironment = mergeAgentLoopbackProxyBypass(environment)
  const proxyFacts = AGENT_PROXY_ENV_KEYS.flatMap((key) => {
    const value = normalizedEnvironment[key]
    return typeof value === 'string' && value.trim().length > 0 ? ([[key, value]] as const) : []
  })

  return createHash('sha256').update(JSON.stringify(proxyFacts)).digest('hex')
}
```

这里故意不导出规则数组、不加入通配域名、不依赖全局代理服务；指纹只包含 Node 子进程可能消费的标准代理变量，避免记录代理凭据原文。

- [ ] **步骤 4：运行纯函数测试并确认通过**

运行同一步骤 2 的命令。

预期：7 个测试全部 PASS。

### 任务 2：把回环规则应用到实际 Agent 子进程环境

**文件：**

- 修改：`src/main/ai/runtime/claudeCode/settingsBuilder.ts:702-821`
- 修改：`src/main/ai/runtime/claudeCode/__tests__/settingsBuilder.test.ts`

- [ ] **步骤 1：先添加 settings 集成测试**

在 `buildClaudeCodeSessionSettings` 的环境变量测试附近添加：

```ts
it('adds Agent-only loopback bypass rules after user proxy env vars are merged', async () => {
  mocks.getProxyEnvironment.mockReturnValue({
    HTTP_PROXY: 'http://remote-proxy.example:7890',
    HTTPS_PROXY: 'http://remote-proxy.example:7890'
  })
  mocks.getAgent.mockReturnValue({
    id: 'agent-1',
    type: 'claude-code',
    model: 'anthropic::claude-sonnet',
    planModel: 'anthropic::claude-sonnet',
    smallModel: 'anthropic::claude-haiku',
    mcps: [],
    allowedTools: [],
    configuration: { env_vars: { no_proxy: 'service.internal; LOCALHOST' } }
  })

  const settings = await buildClaudeCodeSessionSettings(
    {
      id: 'session-1',
      agentId: 'agent-1',
      workspace: { type: 'user', path: '/workspace/project' }
    } as never,
    {} as never
  )

  expect(settings.env).toMatchObject({
    HTTP_PROXY: 'http://remote-proxy.example:7890',
    HTTPS_PROXY: 'http://remote-proxy.example:7890',
    no_proxy: 'service.internal,LOCALHOST,127.0.0.1,::1,[::1]',
    NO_PROXY: 'service.internal,LOCALHOST,127.0.0.1,::1,[::1]'
  })
})
```

- [ ] **步骤 2：运行 settings 测试，确认缺少回环变量而失败**

运行：

```bash
pnpm exec vitest run --project main src/main/ai/runtime/claudeCode/__tests__/settingsBuilder.test.ts
```

预期：新增测试 FAIL；实际 `settings.env` 没有归一化后的两种 bypass 变量。

- [ ] **步骤 3：在所有环境来源合并完成后调用纯函数**

在 `settingsBuilder.ts` 中导入：

```ts
import { mergeAgentLoopbackProxyBypass } from './agentProxyEnvironment'
```

保留现有环境优先级：login shell → Cherry `process.env` 代理 → Agent `env_vars`。在 external CLI 凭据清理完成后，将函数末尾改为：

```ts
return mergeAgentLoopbackProxyBypass(env)
```

不得把调用提前到 Agent `env_vars` 合并之前，否则用户的小写变量会覆盖补全结果；不得移动到 `proxyEnv.ts`，否则会扩大到 Agent 之外的消费者。

- [ ] **步骤 4：运行纯函数与 settings 测试**

运行：

```bash
pnpm exec vitest run --project main \
  src/main/ai/runtime/claudeCode/__tests__/agentProxyEnvironment.test.ts \
  src/main/ai/runtime/claudeCode/__tests__/settingsBuilder.test.ts
```

预期：全部 PASS；现有被保留、被阻止和 external CLI 环境变量测试不回归。

### 任务 3：让代理切换成为连接重建事实

**文件：**

- 修改：`src/main/ai/runtime/claudeCode/agentSessionWarmup.ts:86-93, 288-352, 452-489`
- 修改：`src/main/ai/runtime/claudeCode/__tests__/agentSessionWarmup.test.ts`

- [ ] **步骤 1：扩展测试 mocks，默认提供稳定的 shell 与 Cherry 代理环境**

在 hoisted mocks 中加入：

```ts
getShellEnv: vi.fn(),
getProxyEnvironment: vi.fn(),
```

并添加模块 mock：

```ts
vi.mock('@main/services/proxy/proxyEnv', () => ({
  getProxyEnvironment: mocks.getProxyEnvironment
}))

vi.mock('@main/utils/shellEnv', () => ({
  getShellEnv: mocks.getShellEnv
}))
```

在涉及 query build 和 `deriveConnectionConfig` 的 `beforeEach` 中设置：

```ts
mocks.getShellEnv.mockResolvedValue({})
mocks.getProxyEnvironment.mockReturnValue({})
```

- [ ] **步骤 2：添加代理切换触发签名变化的失败测试**

在 `describe('deriveConnectionConfig')` 中添加：

```ts
it('changes only the proxy rebuild fact when Cherry proxy environment changes', async () => {
  mocks.getProxyEnvironment.mockReturnValue({ HTTP_PROXY: 'http://proxy-a.example:7890' })
  const first = await deriveSignature()

  mocks.getProxyEnvironment.mockReturnValue({ HTTP_PROXY: 'http://proxy-b.example:7890' })
  const changed = await deriveSignature()

  expect(changed.rebuildSignature).not.toBe(first.rebuildSignature)
  expect(
    Object.keys(first.rebuildFactFingerprints).filter(
      (name) => first.rebuildFactFingerprints[name] !== changed.rebuildFactFingerprints[name]
    )
  ).toEqual(['proxyEnvironment'])
})
```

再添加语义等价规则稳定性测试：

```ts
it('keeps the rebuild signature stable for delimiter-only no_proxy differences', async () => {
  mocks.getProxyEnvironment.mockReturnValue({
    HTTP_PROXY: 'http://proxy.example:7890',
    no_proxy: 'service.internal; localhost 127.0.0.1 ::1 [::1]'
  })
  const first = await deriveSignature()

  mocks.getProxyEnvironment.mockReturnValue({
    HTTP_PROXY: 'http://proxy.example:7890',
    NO_PROXY: 'service.internal,localhost,127.0.0.1,::1,[::1]'
  })
  const second = await deriveSignature()

  expect(second.rebuildSignature).toBe(first.rebuildSignature)
})
```

- [ ] **步骤 3：添加物化基线来自实际 settings 的失败测试**

在 query request 测试组中添加：

```ts
it('pins the connection proxy baseline to the environment used to spawn settings', async () => {
  mocks.getProxyEnvironment.mockReturnValue({ HTTP_PROXY: 'http://new-proxy.example:7890' })
  mocks.buildSessionSettings.mockResolvedValueOnce({
    env: {
      HTTP_PROXY: 'http://old-proxy.example:7890',
      no_proxy: 'localhost,127.0.0.1,::1,[::1]',
      NO_PROXY: 'localhost,127.0.0.1,::1,[::1]'
    }
  })

  const request = await buildClaudeCodeQueryRequestForAgentSession('session-1')
  const current = await deriveConnectionConfig('session-1')
  if (!request || !current.ok) throw new Error('expected request and current config')

  expect(request.connectionConfig.rebuildFactFingerprints.proxyEnvironment).not.toBe(
    current.config.rebuildFactFingerprints.proxyEnvironment
  )
})
```

这模拟代理在 settings 物化后发生变化：旧子进程基线必须描述旧代理，新一轮纯派生必须描述新代理。

- [ ] **步骤 4：运行 warmup 测试，确认三个新增断言失败**

运行：

```bash
pnpm exec vitest run --project main src/main/ai/runtime/claudeCode/__tests__/agentSessionWarmup.test.ts
```

预期：FAIL；`rebuildFactFingerprints` 尚无 `proxyEnvironment`。

- [ ] **步骤 5：把代理指纹加入纯派生与物化基线**

在 `agentSessionWarmup.ts` 增加导入：

```ts
import { getProxyEnvironment } from '@main/services/proxy/proxyEnv'
import { getShellEnv } from '@main/utils/shellEnv'

import { createAgentProxyEnvironmentFingerprint } from './agentProxyEnvironment'
```

扩展 `ConnectionMaterializationFacts`：

```ts
interface ConnectionMaterializationFacts {
  route: ClaudeCodeRouteFacts
  mcp: unknown[]
  skills: string[]
  linkedChannelId: string | null
  contextWindow: number | null
  proxyEnvironmentFingerprint: string
}
```

增加纯查询辅助函数；`getShellEnv()` 使用现有缓存且不刷新 shell，行为与 settings builder 一致：

```ts
async function deriveAgentProxyEnvironmentFingerprint(agent: AgentEntity): Promise<string> {
  return createAgentProxyEnvironmentFingerprint({
    ...(await getShellEnv()),
    ...getProxyEnvironment(process.env),
    ...(agent.configuration?.env_vars ?? {})
  })
}
```

在 `deriveConnectionConfigFromSnapshot` 中，在构造 `rebuildFacts` 前取值：

```ts
const proxyEnvironmentFingerprint =
  materialized?.proxyEnvironmentFingerprint ?? (await deriveAgentProxyEnvironmentFingerprint(agent))
```

并在 `rebuildFacts` 中加入可诊断字段：

```ts
proxyEnvironment: proxyEnvironmentFingerprint,
```

在首次 query request 的 `ConnectionMaterializationFacts` 中从已经完成合并的 settings 固化基线：

```ts
proxyEnvironmentFingerprint: createAgentProxyEnvironmentFingerprint(settings.env ?? {})
```

不要把原始代理 URL 直接放进 `rebuildFacts`。连接日志只应报告 `changedFacts: ['proxyEnvironment']`，不得暴露代理凭据。

- [ ] **步骤 6：运行三个 Claude Code 相关测试文件**

运行：

```bash
pnpm exec vitest run --project main \
  src/main/ai/runtime/claudeCode/__tests__/agentProxyEnvironment.test.ts \
  src/main/ai/runtime/claudeCode/__tests__/settingsBuilder.test.ts \
  src/main/ai/runtime/claudeCode/__tests__/agentSessionWarmup.test.ts
```

预期：全部 PASS。无需修改 `AgentSessionRuntimeService` 或 `ClaudeCodeRuntimeDriver`；它们现有的 fresh-turn reconcile、`rebuild` 和后台工作延迟重建测试已经覆盖通用生命周期路径。

### 任务 4：定向验证与提交

**文件：**

- 检查：上述全部源文件、测试文件和本计划文档

- [ ] **步骤 1：运行 Node 类型检查和最接近的测试**

```bash
pnpm typecheck:node
pnpm exec vitest run --project main \
  src/main/ai/runtime/claudeCode/__tests__/agentProxyEnvironment.test.ts \
  src/main/ai/runtime/claudeCode/__tests__/settingsBuilder.test.ts \
  src/main/ai/runtime/claudeCode/__tests__/agentSessionWarmup.test.ts \
  src/main/ai/runtime/claudeCode/__tests__/ClaudeCodeWarmQueryManager.test.ts \
  src/main/ai/runtime/claudeCode/__tests__/ClaudeCodeRuntimeDriver.test.ts
```

预期：命令退出码均为 0。Warm query 测试证明代理变化不会错误复用旧的 parked process；Runtime Driver 测试证明签名变化仍返回通用 `rebuild` 判定。

- [ ] **步骤 2：执行用户指定的定向质量门禁**

```bash
pnpm exec eslint --max-warnings=0 \
  src/main/ai/runtime/claudeCode/agentProxyEnvironment.ts \
  src/main/ai/runtime/claudeCode/__tests__/agentProxyEnvironment.test.ts \
  src/main/ai/runtime/claudeCode/settingsBuilder.ts \
  src/main/ai/runtime/claudeCode/__tests__/settingsBuilder.test.ts \
  src/main/ai/runtime/claudeCode/agentSessionWarmup.ts \
  src/main/ai/runtime/claudeCode/__tests__/agentSessionWarmup.test.ts
pnpm exec biome check \
  src/main/ai/runtime/claudeCode/agentProxyEnvironment.ts \
  src/main/ai/runtime/claudeCode/__tests__/agentProxyEnvironment.test.ts \
  src/main/ai/runtime/claudeCode/settingsBuilder.ts \
  src/main/ai/runtime/claudeCode/__tests__/settingsBuilder.test.ts \
  src/main/ai/runtime/claudeCode/agentSessionWarmup.ts \
  src/main/ai/runtime/claudeCode/__tests__/agentSessionWarmup.test.ts
```

预期：全部退出码为 0。按用户明确要求，不运行 `pnpm test`、`pnpm lint`、`pnpm build:check` 或其他全量门禁；最接近的五个测试文件和六个改动文件静态检查作为本次提交的验证边界。

- [ ] **步骤 3：审查最终差异与范围**

```bash
git diff --check
git status --short
git diff -- \
  src/main/ai/runtime/claudeCode/agentProxyEnvironment.ts \
  src/main/ai/runtime/claudeCode/__tests__/agentProxyEnvironment.test.ts \
  src/main/ai/runtime/claudeCode/settingsBuilder.ts \
  src/main/ai/runtime/claudeCode/__tests__/settingsBuilder.test.ts \
  src/main/ai/runtime/claudeCode/agentSessionWarmup.ts \
  src/main/ai/runtime/claudeCode/__tests__/agentSessionWarmup.test.ts
```

确认没有修改全局代理服务、Electron session 代理或其他网络消费者；自动新增的 bypass 规则只有四个精确回环项。

- [ ] **步骤 4：创建签名且 DCO sign-off 的单一聚焦提交**

```bash
git add \
  docs/superpowers/plans/2026-08-05-agent-loopback-proxy-bypass.md \
  src/main/ai/runtime/claudeCode/agentProxyEnvironment.ts \
  src/main/ai/runtime/claudeCode/__tests__/agentProxyEnvironment.test.ts \
  src/main/ai/runtime/claudeCode/settingsBuilder.ts \
  src/main/ai/runtime/claudeCode/__tests__/settingsBuilder.test.ts \
  src/main/ai/runtime/claudeCode/agentSessionWarmup.ts \
  src/main/ai/runtime/claudeCode/__tests__/agentSessionWarmup.test.ts
git commit -S --signoff -m "fix(agent-runtime): bypass proxy for loopback gateways"
```

- [ ] **步骤 5：验证提交签名和工作区状态**

```bash
git cat-file commit HEAD | rg '^gpgsig '
git show --show-signature --stat --oneline HEAD
git status --short --branch
```

预期：commit 对象包含 `gpgsig`，提交显示有效签名，工作区干净并仍位于 `codex/fix-agent-no-proxy-loopback`。

## 验收标准

- Cherry 代理开启且用户没有 bypass 规则时，Agent 子进程的 `NO_PROXY` 与 `no_proxy` 均为 `localhost,127.0.0.1,::1,[::1]`。
- 用户已有规则按小写优先顺序合并、保留文本、大小写不敏感去重；分号、逗号和空白均被接受。
- 用户明确配置 `*` 时保持全局直连语义；无 `*` 时外部模型地址没有被自动加入 bypass，代理端点变量保持不变。
- `http://127.0.0.1:23333` 和 `http://[::1]:23333` 对兼容 Node 代理库命中 bypass；非白名单外网仍使用原代理。
- 切换 Cherry 代理后，不中断当前轮次；下一轮 fresh turn 检测到 `proxyEnvironment` 事实变化并重建已连接 Agent 子进程。
- parked warm query 继续依靠完整 `options.env` 签名拒绝旧环境，无需额外生命周期代码。
- Electron 全局代理、普通聊天网络栈和外部模型路由未被修改。
