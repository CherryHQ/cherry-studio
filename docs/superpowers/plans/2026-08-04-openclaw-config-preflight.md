# OpenClaw 配置预检与管理区重建实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 `superpowers-zh:subagent-driven-development`（推荐）或 `superpowers-zh:executing-plans` 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法跟踪进度。

**目标：** 使用 Cherry Studio 实际解析出的 OpenClaw 二进制，在覆盖配置和启动 Gateway 前验证配置；同步时完整重建所有 `cherry-*` Provider，消除截图中的陈旧字段，同时保留非 Cherry 配置和安全诊断边界。

**架构：** 将 OpenClaw 专用的命令执行、结构化校验、错误分类和脱敏保留在 `OpenClawService` 内，不改变 IPC。`sync_config` 构建同目录候选文件并通过 `config validate --json` 后原子提交；`start_gateway` 对正式文件复检后才停止旧 Gateway 和启动新进程。

**技术栈：** TypeScript、Electron 主进程、`crossPlatformSpawn`、BinaryManager、`atomicWriteFile`、Vitest、主进程 i18n。

---

## 规格与约束

- 设计规格：`docs/superpowers/specs/2026-08-03-openclaw-config-preflight-design.md`
- 不修改共享 IPC Schema、BinaryManager、通用 `processRunner` 或 Renderer 业务逻辑。
- 不解析 JSON5，不运行 `doctor --fix`，不动态降级字段，不增加并发内容比较。
- `openclaw.cherry.json` 的既有迁移顺序和 `.bak` 语义保持不变。
- 所有实现提交必须使用 `git commit -S --signoff`。
- 在没有嵌套 `.claude/worktrees` 的独立 worktree 中执行门禁；不得移动、删除或修改当前仓库内其他 worktree 来规避 ESLint 扫描。

## 文件结构

### 修改

- `src/main/services/OpenClawService.ts`
  - OpenClaw Runtime 解析、受限子进程输出、Schema 能力探测、validate 结果解析；
  - 错误分类、问题摘要和秘密脱敏；
  - `cherry-*` 管理区重建、候选验证、`0600` 原子提交；
  - Gateway 启动前正式配置复检及固定配置路径。
- `src/main/services/__tests__/OpenClawService.test.ts`
  - 子进程与预检测试；
  - 管理区所有权、候选写入、外部配置失败、权限和清理测试；
  - 启动顺序、环境固定和 Gateway 输出脱敏测试。
- `src/main/i18n/locales/en-us.json`
  - 新增预检、二进制不兼容、外部配置无效和剩余问题数量文案。
- `src/main/i18n/locales/zh-cn.json`
  - 对应中文文案。
- `src/main/i18n/translate/*.json`
  - 由 `pnpm i18n:sync` 补齐 10 个主进程翻译目录的同构 key；不在本修复中手工翻译。
- `src/renderer/pages/code/hooks/__tests__/useOpenClawGatewayController.test.ts`
  - 固定 `sync_config` 失败后不得调用 `start_gateway` 的既有控制流。

### 不创建

- 不创建新的共享类型、通用工具、IPC Route、Service 或 Renderer 组件。
- `OpenClawService.ts` 是现有单文件服务；本修复没有第二个消费者，不抽取新目录。

---

### 任务 0：建立不受嵌套 worktree 污染的执行环境

**文件：** 无业务文件修改。

- [ ] **步骤 1：确认目标目录可安全创建**

在当前仓库运行：

```bash
git status --short
test ! -e /Users/gujiaming/Desktop/cherry-studio-openclaw-preflight
git worktree list
```

预期：当前修复分支工作区干净，目标路径不存在。若目标路径已经存在，停止并按
`superpowers-zh:using-git-worktrees` 重新选择明确的新路径；不得删除或复用未知目录。

- [ ] **步骤 2：把现有修复分支迁入外部独立 worktree**

在当前仓库运行：

```bash
git switch main
git worktree add /Users/gujiaming/Desktop/cherry-studio-openclaw-preflight codex/openclaw-config-preflight
```

此后所有任务都以 `/Users/gujiaming/Desktop/cherry-studio-openclaw-preflight` 为工作目录。预期：
原工作区位于 `main`，外部 worktree 位于 `codex/openclaw-config-preflight`，且没有当前仓库中
现存的 `.claude/worktrees` 子目录。

- [ ] **步骤 3：安装锁定依赖并验证基线**

在外部 worktree 运行：

```bash
pnpm install
pnpm exec vitest run --project main src/main/services/__tests__/OpenClawService.test.ts
pnpm exec vitest run --project renderer src/renderer/pages/code/hooks/__tests__/useOpenClawGatewayController.test.ts
git status --short
```

预期：安装遵守 `package.json` 锁定的 Node/pnpm 版本；两组基线测试退出 0；工作区无新增跟踪
变更。依赖安装若只产生被忽略文件可继续，若修改 lockfile 或其他跟踪文件则停止调查。

---

### 任务 1：建立 OpenClaw 专用预检与安全诊断边界

**文件：**

- 修改：`src/main/services/OpenClawService.ts:1-175,523-707`
- 修改：`src/main/services/__tests__/OpenClawService.test.ts:1-180`
- 修改：`src/main/i18n/locales/en-us.json`
- 修改：`src/main/i18n/locales/zh-cn.json`
- 修改（同步生成）：`src/main/i18n/translate/*.json`

- [ ] **步骤 1：为结构化命令、Schema 能力和脱敏编写失败测试**

在测试文件加入可控 ChildProcess。它必须在监听器注册后异步发送输出和退出事件：

```ts
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'

function queueSpawnResult(options: { stdout?: string; stderr?: string; exitCode: number | null }) {
  const child = new EventEmitter() as EventEmitter & {
    stdout: PassThrough
    stderr: PassThrough
    kill: ReturnType<typeof vi.fn>
    unref: ReturnType<typeof vi.fn>
  }
  child.stdout = new PassThrough()
  child.stderr = new PassThrough()
  child.kill = vi.fn()
  child.unref = vi.fn()
  crossPlatformSpawnMock.mockReturnValueOnce(child as never)
  queueMicrotask(() => {
    if (options.stdout) child.stdout.write(options.stdout)
    if (options.stderr) child.stderr.write(options.stderr)
    child.stdout.end()
    child.stderr.end()
    child.emit('exit', options.exitCode)
    child.emit('close', options.exitCode)
  })
  return child
}
```

扩展 `application.get` mock，使主进程 `t()` 能读取固定语言：

```ts
if (name === 'PreferenceService') {
  return { get: vi.fn(() => 'en-US') }
}
```

新增以下测试：

```ts
it('keeps structured validate issues when OpenClaw exits with code 1', async () => {
  queueSpawnResult({
    exitCode: 1,
    stdout: JSON.stringify({
      valid: false,
      path: '/mock/.openclaw/openclaw.json',
      issues: [{ path: 'tools.web.fetch.ssrfPolicy', message: 'Unrecognized key' }]
    })
  })

  const result = await (service as any).runOpenClawCommand(
    '/mock/bin/openclaw',
    ['config', 'validate', '--json'],
    { PATH: '/mock/bin' }
  )

  expect(result).toMatchObject({ exitCode: 1, outputTruncated: false })
  expect(JSON.parse(result.stdout).issues[0].path).toBe('tools.web.fetch.ssrfPolicy')
})

it('classifies an unavailable schema command as binary incompatible', async () => {
  queueSpawnResult({
    exitCode: 1,
    stderr: 'unknown command: schema'
  })

  await expect(
    (service as any).assertSchemaCapability({
      binary: { source: 'mise', path: '/mock/bin/openclaw', version: '1.0.0' },
      shellEnv: { PATH: '/mock/bin' }
    })
  ).rejects.toMatchObject({ kind: 'binary_incompatible' })
})

it('redacts secrets and bounds diagnostic text', () => {
  const secret = 'sk-real-secret'
  const input = `apiKey: "${secret}"\nAuthorization: Bearer token-value\n${'x'.repeat(3000)}`
  const result = (service as any).sanitizeDiagnostic(input)

  expect(result).not.toContain(secret)
  expect(result).not.toContain('token-value')
  expect(result).toContain('<redacted>')
  expect(result.length).toBeLessThanOrEqual(2000)
})

```

- [ ] **步骤 2：运行定向测试并确认失败原因**

运行：

```bash
pnpm exec vitest run --project main src/main/services/__tests__/OpenClawService.test.ts
```

预期：FAIL；`runOpenClawCommand`、`assertSchemaCapability` 和 `sanitizeDiagnostic` 尚不存在。
现有测试不得出现与这些缺失方法无关的新失败。

- [ ] **步骤 3：增加本地类型、常量和错误类型**

在 `OpenClawService.ts` 增加以下服务内类型和常量，不导出：

```ts
const OPENCLAW_COMMAND_TIMEOUT_MS = 10_000
const OPENCLAW_CAPTURE_LIMIT_BYTES = 1024 * 1024
const OPENCLAW_DIAGNOSTIC_LIMIT_CHARS = 2_000

type OpenClawFailureKind = 'binary_incompatible' | 'external_config_invalid' | 'preflight_failed'

interface OpenClawRuntime {
  binary: Exclude<BinaryAvailability, { source: 'none' }>
  shellEnv: Record<string, string>
}

interface OpenClawCommandResult {
  exitCode: number | null
  stdout: string
  stderr: string
  outputTruncated: boolean
}

interface OpenClawValidationIssue {
  path: string
  message: string
  allowedValues?: unknown[]
}

class OpenClawPreflightError extends Error {
  constructor(readonly kind: OpenClawFailureKind, message: string) {
    super(message)
    this.name = 'OpenClawPreflightError'
  }
}
```

错误对象不得保存原始 Issue 数组；否则 `logger.error(error)` 序列化附加属性时可能把秘密重新
写入日志。分类完成后只保留内部 `kind` 和已脱敏的 `message`。

将路径工厂声明为已验证的绝对路径，以便使用文件工具：

```ts
const openclawConfigPath = () =>
  AbsoluteFilePathSchema.parse(path.join(openclawConfigDir(), 'openclaw.json'))
```

新增 imports：

```ts
import { t } from '@main/i18n'
import { AbsoluteFilePathSchema, type AbsoluteFilePath } from '@shared/types/file'
```

- [ ] **步骤 4：实现受限命令执行、解析和错误格式化**

实现 `runOpenClawCommand`，要求如下代码契约全部成立：

```ts
private runOpenClawCommand(
  openclawPath: string,
  args: string[],
  env: Record<string, string>
): Promise<OpenClawCommandResult> {
  return new Promise((resolve, reject) => {
    const child = crossPlatformSpawn(openclawPath, args, { env, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = Buffer.alloc(0)
    let stderr = Buffer.alloc(0)
    let outputTruncated = false
    let settled = false

    const append = (current: Buffer, chunk: Buffer | string): Buffer => {
      const incoming = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      const remaining = OPENCLAW_CAPTURE_LIMIT_BYTES - current.byteLength
      if (remaining <= 0) {
        outputTruncated = true
        return current
      }
      if (incoming.byteLength > remaining) outputTruncated = true
      return Buffer.concat([current, incoming.subarray(0, remaining)])
    }

    child.stdout?.on('data', (chunk) => {
      stdout = append(stdout, chunk)
    })
    child.stderr?.on('data', (chunk) => {
      stderr = append(stderr, chunk)
    })

    const timeout = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill('SIGKILL')
      reject(new OpenClawPreflightError('preflight_failed', t('openclaw.errors.preflight_failed')))
    }, OPENCLAW_COMMAND_TIMEOUT_MS)
    timeout.unref()

    child.once('error', (error) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      reject(error)
    })
    child.once('close', (exitCode) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      resolve({
        exitCode,
        stdout: stdout.toString('utf8'),
        stderr: stderr.toString('utf8'),
        outputTruncated
      })
    })
  })
}
```

实现以下私有方法：

```ts
private sanitizeDiagnostic(message: string): string
private assertSchemaCapability(runtime: OpenClawRuntime): Promise<void>
```

行为必须精确为：

- `sanitizeDiagnostic` 先把 `Bearer <value>` 替换为 `Bearer <redacted>`，再对大小写不敏感的
  `apiKey`、`api_key`、`token`、`auth`、`secret`、`password` 键值进行替换，最后截到 2000
  字符；
- `assertSchemaCapability` 使用正式 `openclaw.json` 作为 `OPENCLAW_CONFIG_PATH`，执行
  `config schema --json`，要求退出码 0、输出未截断且 JSON 顶层为非数组对象；失败统一抛
  `binary_incompatible`；记录失败原因时只使用 `sanitizeDiagnostic` 处理后的摘要。

- [ ] **步骤 5：解析实际 Runtime，并在同步迁移前探测 Schema**

实现：

```ts
private async resolveOpenClawRuntime(): Promise<OpenClawRuntime> {
  const managedShellEnv = await refreshShellEnv()
  const binary = await this.findOpenClawBinary()
  if (!binary) {
    throw new Error('OpenClaw binary not found. Please install OpenClaw first.')
  }
  const shellEnv = binary.source === 'system' ? await getRawShellEnv() : managedShellEnv
  logger.info('Resolved OpenClaw runtime', {
    source: binary.source,
    path: binary.path,
    version: binary.version ?? 'unknown'
  })
  return { binary, shellEnv }
}
```

`runOpenClawCommand` 存在后，在 `describe` 顶层声明命令 spy，并在现有 `beforeEach` 的
`service = await createService()` 之后保存默认成功实现：

```ts
let runCommandSpy: ReturnType<typeof vi.spyOn>

runCommandSpy = vi.spyOn(service as any, 'runOpenClawCommand').mockResolvedValue({
  exitCode: 0,
  stdout: '{}',
  stderr: '',
  outputTruncated: false
})
```

同时在步骤 1 的前两个子进程测试开头各加一行 `runCommandSpy.mockRestore()`，确保它们仍覆盖
真实本地 runner；其余既有同步测试使用默认成功结果。

在 `syncProviderConfig` 的文件迁移之前执行：

```ts
const runtime = await this.resolveOpenClawRuntime()
await this.assertSchemaCapability(runtime)
```

这让 `resolveOpenClawRuntime` 和 `assertSchemaCapability` 在本提交中具有生产调用者，并保证不
会先迁移旧配置再发现二进制不支持预检。

- [ ] **步骤 6：增加主进程中英文文案**

在两个主进程 locale 根节点加入：

```json
"openclaw": {
  "errors": {
    "binary_incompatible": "The OpenClaw binary used by Cherry Studio is incompatible with the generated configuration. Upgrade OpenClaw.{{details}}",
    "external_config_invalid": "OpenClaw rejected configuration outside Cherry Studio's managed provider section. Fix that configuration or upgrade OpenClaw.{{details}}",
    "more_issues": "and {{count}} more issue(s)",
    "preflight_failed": "Cherry Studio could not validate the OpenClaw configuration."
  }
}
```

```json
"openclaw": {
  "errors": {
    "binary_incompatible": "Cherry Studio 当前使用的 OpenClaw 与生成的配置不兼容，请升级 OpenClaw。{{details}}",
    "external_config_invalid": "OpenClaw 拒绝了 Cherry Studio 管理区之外的配置，请修正该配置或升级 OpenClaw。{{details}}",
    "more_issues": "另有 {{count}} 个问题",
    "preflight_failed": "Cherry Studio 无法验证 OpenClaw 配置。"
  }
}
```

不要迁移其他既有硬编码错误文案。

随后运行 `pnpm i18n:sync`。该命令以 `locales/en-us.json` 为基准，为
`src/main/i18n/translate/*.json` 补齐上述 key，并写入仓库规定的 `[to be translated]:...`
占位值；不要手工编造其余 10 种语言的翻译。

- [ ] **步骤 7：运行测试、i18n 和类型检查**

运行：

```bash
pnpm exec vitest run --project main src/main/services/__tests__/OpenClawService.test.ts
pnpm i18n:sync
pnpm i18n:check
pnpm typecheck:node
```

预期：四个命令均退出 0；新增三个测试通过，既有同步测试通过默认 Schema 命令 spy；同步只
给主进程翻译目录补齐新 key 并保持全目录排序。

- [ ] **步骤 8：运行提交前门禁并提交**

运行：

```bash
pnpm build:check
git status --short
git add src/main/services/OpenClawService.ts src/main/services/__tests__/OpenClawService.test.ts src/main/i18n/locales/en-us.json src/main/i18n/locales/zh-cn.json src/main/i18n/translate
git commit -S --signoff -m "feat(openclaw): add config preflight diagnostics"
git cat-file commit HEAD | grep '^gpgsig '
git show -s --format='%B' HEAD | grep '^Signed-off-by:'
```

预期：`build:check` 退出 0；status 中只有本任务列出的服务、测试和主进程 i18n 文件；签名
和 DCO 两项检查均找到一行。

---

### 任务 2：重建 Cherry 管理区并验证候选后原子提交

**文件：**

- 修改：`src/main/services/OpenClawService.ts:523-827`
- 修改：`src/main/services/__tests__/OpenClawService.test.ts:428-994`

- [ ] **步骤 1：为管理区重建和候选事务编写失败测试**

在 `describe` 顶层增加两个可恢复的 spy 变量，并在现有顶层 `beforeEach` 中紧接任务 1 的
`runCommandSpy` 初始化之后，为既有测试提供有效预检默认值：

```ts
let schemaCapabilitySpy: ReturnType<typeof vi.spyOn>
let validateConfigSpy: ReturnType<typeof vi.spyOn>

schemaCapabilitySpy = vi.spyOn(service as any, 'assertSchemaCapability').mockResolvedValue(undefined)
validateConfigSpy = vi.spyOn(service as any, 'validateConfig').mockResolvedValue({
  valid: true,
  path: '/mock/.openclaw/openclaw.json',
  issues: [],
  warnings: []
})
```

新增 validate 解析失败测试：

```ts
it('rejects malformed validate JSON as a preflight failure', () => {
  expect(() =>
    (service as any).parseValidationResult({
      exitCode: 1,
      stdout: 'not-json apiKey="sk-real-secret"',
      stderr: '',
      outputTruncated: false
    })
  ).toThrow(/validate/i)
})
```

将“手工值优先”测试替换为所有权回归测试：

```ts
it('rebuilds every cherry provider while preserving non-Cherry config', async () => {
  const configPath = path.join(configDir, 'openclaw.json')
  fs.writeFileSync(
    configPath,
    JSON.stringify({
      tools: { web: { search: { enabled: true } } },
      models: {
        mode: 'merge',
        providers: {
          'cherry-minimax': { maxTokens: 8192, models: [] },
          'cherry-openai': {
            baseUrl: 'https://old.example.com',
            apiKey: 'old-key',
            api: 'openai-completions',
            headers: { 'X-Manual': 'remove' },
            models: [{ id: 'gpt-4o', name: 'Old', maxTokens: 32000 }]
          },
          external: {
            baseUrl: 'https://external.example.com',
            apiKey: 'external-key',
            api: 'openai-completions',
            models: []
          }
        }
      }
    })
  )

  await service.syncProviderConfig(
    { ...legacyProvider, headers: { 'X-Synced': 'yes' } } as any,
    legacyModel
  )

  const written = JSON.parse(fs.readFileSync(configPath, 'utf8'))
  expect(Object.keys(written.models.providers).sort()).toEqual(['cherry-openai', 'external'])
  expect(written.models.providers['cherry-openai']).toMatchObject({
    apiKey: 'sk-test',
    headers: { 'X-Synced': 'yes' },
    models: [{ id: 'gpt-4o', name: 'GPT-4o' }]
  })
  expect(written.models.providers['cherry-openai'].headers).not.toHaveProperty('X-Manual')
  expect(written.models.providers.external.apiKey).toBe('external-key')
  expect(written.tools.web.search.enabled).toBe(true)
})
```

增加外部配置失败测试：

```ts
it('leaves the formal file unchanged when preserved external config is invalid', async () => {
  const configPath = path.join(configDir, 'openclaw.json')
  const original = JSON.stringify({ tools: { web: { fetch: { ssrfPolicy: 'strict' } } } }, null, 2)
  fs.writeFileSync(configPath, original)
  validateConfigSpy.mockResolvedValue({
    valid: false,
    path: configPath,
    issues: [{ path: 'tools.web.fetch.ssrfPolicy', message: 'Unrecognized key' }],
    warnings: []
  })

  const result = await service.syncProviderConfig(legacyProvider, legacyModel)

  expect(result.success).toBe(false)
  expect('message' in result && result.message).toContain('tools.web.fetch.ssrfPolicy')
  expect(fs.readFileSync(configPath, 'utf8')).toBe(original)
  expect(fs.readdirSync(configDir).filter((name) => name.includes('cherry-candidate'))).toEqual([])
})
```

增加 Issue 脱敏和最多三项摘要测试：

```ts
it('redacts secrets and limits external validation details to three issues', async () => {
  fs.writeFileSync(path.join(configDir, 'openclaw.json'), '{}')
  validateConfigSpy.mockResolvedValue({
    valid: false,
    path: path.join(configDir, 'openclaw.json'),
    issues: [
      { path: 'tools.one', message: 'apiKey="sk-issue-secret"' },
      { path: 'tools.two', message: 'Authorization: Bearer issue-token' },
      { path: 'tools.three', message: 'third issue' },
      { path: 'tools.four', message: 'fourth issue' },
      { path: 'tools.five', message: 'fifth issue' }
    ],
    warnings: []
  })

  const result = await service.syncProviderConfig(legacyProvider, legacyModel)
  const message = 'message' in result ? result.message : ''

  expect(result.success).toBe(false)
  expect(message).not.toMatch(/sk-issue-secret|issue-token/)
  expect(message).toContain('tools.one')
  expect(message).toContain('tools.three')
  expect(message).not.toContain('tools.four')
  expect(message).toContain('and 2 more')
})
```

增加 Cherry 字段不兼容、候选路径和文件权限测试：

```ts
it('classifies rejected generated Cherry fields as binary incompatible', async () => {
  const configPath = path.join(configDir, 'openclaw.json')
  fs.writeFileSync(configPath, JSON.stringify({ keep: true }))
  validateConfigSpy.mockResolvedValue({
    valid: false,
    path: configPath,
    issues: [{ path: 'models.providers.cherry-openai.models.0.maxTokens', message: 'Unrecognized key' }],
    warnings: []
  })

  const result = await service.syncProviderConfig(legacyProvider, legacyModel)

  expect(result.success).toBe(false)
  expect('message' in result && result.message).toMatch(/incompatible/i)
  expect(JSON.parse(fs.readFileSync(configPath, 'utf8'))).toEqual({ keep: true })
})

it('validates a same-directory candidate and atomically writes mode 0600', async () => {
  const result = await service.syncProviderConfig(legacyProvider, legacyModel)

  expect(result).toEqual({ success: true })
  const candidatePath = validateConfigSpy.mock.calls[0][1] as string
  expect(path.dirname(candidatePath)).toBe(configDir)
  expect(path.basename(candidatePath)).toContain('cherry-candidate')
  expect(fs.existsSync(candidatePath)).toBe(false)
  if (process.platform !== 'win32') {
    expect(fs.statSync(path.join(configDir, 'openclaw.json')).mode & 0o777).toBe(0o600)
  }
})
```

- [ ] **步骤 2：运行定向测试并确认所有权测试失败**

运行：

```bash
pnpm exec vitest run --project main src/main/services/__tests__/OpenClawService.test.ts
```

预期：FAIL；首先会明确指出 `validateConfig` / `parseValidationResult` 尚不存在。步骤 3 加入
解析与校验方法后，所有权和候选测试仍应保持红色，直到步骤 4–5 删除旧 `cherry-*` 合并并
接入候选原子流程；不得通过放宽断言提前转绿。

- [ ] **步骤 3：实现 validate 解析、错误分类和问题摘要**

增加任务 1 尚未需要的常量和报告类型：

```ts
const OPENCLAW_VISIBLE_ISSUE_LIMIT = 3
const OPENCLAW_CONFIG_FILE_MODE = 0o600

interface OpenClawValidationReport {
  valid: boolean
  path?: string
  issues: OpenClawValidationIssue[]
  warnings: OpenClawValidationIssue[]
}
```

实现：

```ts
private parseValidationResult(result: OpenClawCommandResult): OpenClawValidationReport
private formatValidationDetails(issues: OpenClawValidationIssue[]): string
private validateConfig(runtime: OpenClawRuntime, configPath: AbsoluteFilePath): Promise<OpenClawValidationReport>
private assertConfigValid(runtime: OpenClawRuntime, configPath: AbsoluteFilePath): Promise<void>
```

行为必须精确为：

- `parseValidationResult` 接受退出码 1 的合法 `{ valid: false, issues }`；
- `valid: false` 且 issues 为空、字段类型错误、输出截断或 stdout 非 JSON 时抛
  `preflight_failed`；
- `valid: true` 且退出码不为 0 时抛 `preflight_failed`；
- `validateConfig` 执行 `config validate --json`，只解析 stdout，不把原始 stdout/stderr 放进
  Error；
- `assertConfigValid` 对包含 `models.providers.cherry-` 路径的问题抛
  `binary_incompatible`；只有外部路径时抛 `external_config_invalid`；有效报告中的 warnings 只
  记录脱敏日志；
- Toast 摘要最多三项；每项先拼成 `path: message`，再整体调用 `sanitizeDiagnostic`，剩余项使用
  i18n 数量文案，保证 Issue 路径和消息都不能绕过脱敏。

- [ ] **步骤 4：完整重建 `cherry-*` 管理区**

删除 `existingProvider`、`existingModelMap` 及所有 `...existing` 合并。用以下结构生成 Provider：

```ts
const providerHeaders = (provider as OpenClawSyncProvider).headers
const openclawProvider: OpenClawProviderConfig = {
  baseUrl,
  apiKey,
  api: apiType,
  ...(providerHeaders && Object.keys(providerHeaders).length > 0 ? { headers: { ...providerHeaders } } : {}),
  models: provider.models.map((model) => {
    const synced = model as OpenClawSyncModel
    return {
      ...(synced.maxTokens ? { maxTokens: synced.maxTokens } : {}),
      ...(synced.reasoning !== undefined ? { reasoning: synced.reasoning } : {}),
      ...(synced.input ? { input: synced.input } : {}),
      ...(synced.cost ? { cost: synced.cost } : {}),
      id: model.id,
      name: model.name,
      contextWindow: synced.contextWindow ?? 128000
    }
  })
}

const preservedProviders = Object.fromEntries(
  Object.entries(config.models?.providers ?? {}).filter(([key]) => !key.startsWith('cherry-'))
)
config.models = {
  ...(config.models ?? { mode: 'merge' }),
  providers: {
    ...preservedProviders,
    [providerKey]: openclawProvider
  }
}
```

Gateway、update 和 primary model 的既有生成逻辑保持原样。

- [ ] **步骤 5：实现候选校验和原子提交**

新增 imports：

```ts
import { atomicWriteFile, remove } from '@main/utils/file'
```

用以下流程替换 `fs.writeFileSync(openclawConfigPath(), ...)`：

```ts
const serialized = JSON.stringify(config, null, 2)
const candidatePath = AbsoluteFilePathSchema.parse(
  path.join(openclawConfigDir(), `openclaw.json.cherry-candidate-${crypto.randomUUID()}`)
)

try {
  await atomicWriteFile(candidatePath, serialized, { mode: OPENCLAW_CONFIG_FILE_MODE })
  await this.assertConfigValid(runtime, candidatePath)
  await atomicWriteFile(openclawConfigPath(), serialized, { mode: OPENCLAW_CONFIG_FILE_MODE })
} finally {
  await remove(candidatePath).catch((cleanupError) =>
    logger.warn('Failed to remove OpenClaw candidate config', {
      path: candidatePath,
      error: this.sanitizeDiagnostic(cleanupError instanceof Error ? cleanupError.message : String(cleanupError))
    })
  )
}
```

只允许在 `valid: true` 后写正式文件。候选校验失败不得写入部分 Cherry 修复；旧迁移已经发生
时仍遵守设计文档记录的迁移例外。

- [ ] **步骤 6：运行定向测试、类型检查和格式化**

运行：

```bash
pnpm exec vitest run --project main src/main/services/__tests__/OpenClawService.test.ts
pnpm typecheck:node
pnpm exec biome format --write src/main/services/OpenClawService.ts src/main/services/__tests__/OpenClawService.test.ts
```

预期：全部退出 0；旧手工值优先断言已被所有权断言替代，不通过放宽新断言保留旧行为。

- [ ] **步骤 7：运行提交前门禁并提交**

运行：

```bash
pnpm build:check
git status --short
git add src/main/services/OpenClawService.ts src/main/services/__tests__/OpenClawService.test.ts
git commit -S --signoff -m "fix(openclaw): validate rebuilt provider config"
git cat-file commit HEAD | grep '^gpgsig '
git show -s --format='%B' HEAD | grep '^Signed-off-by:'
```

预期：门禁退出 0，提交只包含两个文件。

---

### 任务 3：启动前复检、固定配置路径并覆盖 Renderer 回归

**文件：**

- 修改：`src/main/services/OpenClawService.ts:180-329`
- 修改：`src/main/services/__tests__/OpenClawService.test.ts:247-410,996-1040`
- 修改：`src/renderer/pages/code/hooks/__tests__/useOpenClawGatewayController.test.ts:1-117`

- [ ] **步骤 1：编写启动顺序和环境失败测试**

新增正式配置无效时不触碰端口或旧 Gateway 的测试：

```ts
it('validates the formal config before checking or stopping the current gateway', async () => {
  checkPortOpenSpy.mockResolvedValue(true)
  validateConfigSpy.mockResolvedValue({
    valid: false,
    path: '/mock/.openclaw/openclaw.json',
    issues: [{ path: 'tools.web.fetch.ssrfPolicy', message: 'Unrecognized key' }],
    warnings: []
  })
  const stopSpy = vi.spyOn(service, 'stopGateway')

  const result = await service.startGateway()

  expect(result.success).toBe(false)
  expect(checkPortOpenSpy).not.toHaveBeenCalled()
  expect(stopSpy).not.toHaveBeenCalled()
  expect(startAndWaitSpy).not.toHaveBeenCalled()
})
```

更新 Windows Gateway spawn 断言并增加 system/managed 覆盖：

```ts
expect(crossPlatformSpawnMock).toHaveBeenCalledWith(
  openclawPath,
  ['gateway', 'run', '--force'],
  expect.objectContaining({
    env: expect.objectContaining({
      OPENCLAW_CONFIG_PATH: path.join('/mock/.openclaw', 'openclaw.json'),
      OPENCLAW_NO_AUTO_UPDATE: '1'
    })
  })
)
```

测试 Schema 与 validate 均收到正式路径：

```ts
it('pins schema and formal validation to Cherry Studio\'s OpenClaw config path', async () => {
  schemaCapabilitySpy.mockRestore()
  validateConfigSpy.mockRestore()
  runCommandSpy.mockReset()
  runCommandSpy
    .mockResolvedValueOnce({ exitCode: 0, stdout: '{}', stderr: '', outputTruncated: false })
    .mockResolvedValueOnce({
      exitCode: 0,
      stdout: JSON.stringify({ valid: true, path: '/mock/.openclaw/openclaw.json', issues: [] }),
      stderr: '',
      outputTruncated: false
    })
  checkPortOpenSpy.mockResolvedValue(false)
  startAndWaitSpy.mockResolvedValue(undefined)

  await service.startGateway()

  for (const call of runCommandSpy.mock.calls) {
    expect(call[2].OPENCLAW_CONFIG_PATH).toBe(path.join('/mock/.openclaw', 'openclaw.json'))
  }
})
```

- [ ] **步骤 2：编写 Gateway 诊断脱敏失败测试**

使用可控 ChildProcess 让 `gateway run` 早退并输出秘密：

```ts
it('redacts and bounds gateway early-exit diagnostics', async () => {
  const child = queueSpawnResult({
    exitCode: 1,
    stderr: `apiKey="sk-gateway-secret"\nAuthorization: Bearer gateway-token\n${'x'.repeat(3000)}`
  })
  vi.useFakeTimers()

  const started = (service as any).startAndWaitForGateway('/mock/bin/openclaw', { PATH: '/mock/bin' })
  const failure = started.catch((error: Error) => error)
  await vi.runAllTimersAsync()

  const error = await failure
  expect(error).toBeInstanceOf(Error)
  expect(error.message).not.toMatch(/sk-gateway-secret|gateway-token/)
  expect(error.message.length).toBeLessThanOrEqual(2000)
  expect(child.unref).toHaveBeenCalledOnce()
})
```

预期当前测试失败：Gateway env 尚未固定路径，正式配置未预检，stdout/stderr 仍无限累积且未脱敏。

- [ ] **步骤 3：编写 Renderer 同步失败回归测试**

补充 Toast mock：

```ts
const toastErrorMock = vi.hoisted(() => vi.fn())

vi.mock('@renderer/services/toast', () => ({
  toast: { error: toastErrorMock }
}))
```

新增测试：

```ts
it('does not start the gateway when config sync fails', async () => {
  mocks.requestMock.mockImplementation((route: string) => {
    if (route === 'openclaw.sync_config') {
      return Promise.resolve({ success: false, message: 'tools.web.fetch.ssrfPolicy: Unrecognized key' })
    }
    if (route === 'openclaw.get_status') return Promise.resolve({ status: 'stopped' })
    return Promise.resolve({ success: true })
  })

  const { result } = renderHook(() =>
    useOpenClawGatewayController({
      selectedCliTool: CodeCli.OPENCLAW,
      enabledProvider,
      currentProviderConfig: { modelId: 'anthropic::claude-sonnet-4-5' },
      upsertProviderConfig: vi.fn(),
      setCurrentProvider: vi.fn()
    })
  )

  await act(async () => {
    await result.current.onLaunch()
  })

  expect(mocks.requestMock).not.toHaveBeenCalledWith('openclaw.start_gateway', expect.anything())
  expect(toastErrorMock).toHaveBeenCalledWith('tools.web.fetch.ssrfPolicy: Unrecognized key')
})
```

该测试应立即通过，因为 Renderer 已有正确控制流；它是防回归锁，不要求修改 Hook。

- [ ] **步骤 4：把正式预检移到端口处理之前**

重排 `startGateway`：

```ts
public async startGateway(port?: number): Promise<OperationResult> {
  this.gatewayPort = port ?? DEFAULT_GATEWAY_PORT
  if (this.gatewayStatus === 'starting') {
    return { success: false, message: 'Gateway is already starting' }
  }

  try {
    const runtime = await this.resolveOpenClawRuntime()
    await this.assertSchemaCapability(runtime)
    await this.assertConfigValid(runtime, openclawConfigPath())

    const isPortOpen = await this.checkPortOpen(this.gatewayPort)
    if (isPortOpen) {
      const { status } = await this.checkGatewayHealth()
      if (status === 'healthy') {
        logger.info('Detected stale gateway on port, stopping before restart...')
        await this.stopGateway()
        const stillOpen = await this.checkPortOpen(this.gatewayPort)
        if (stillOpen) {
          return {
            success: false,
            message: `Port ${this.gatewayPort} is still in use after stopping the old gateway.`
          }
        }
      } else {
        return {
          success: false,
          message: `Port ${this.gatewayPort} is already in use by another application. Please choose a different port.`
        }
      }
    }

    this.gatewayStatus = 'starting'
    await this.startAndWaitForGateway(runtime.binary.path, runtime.shellEnv)
    this.gatewayStatus = 'running'
    logger.info(`Gateway started on port ${this.gatewayPort}`)
    return { success: true }
  } catch (error) {
    this.gatewayStatus = 'error'
    const errorMessage = error instanceof Error ? error.message : String(error)
    logger.error('Failed to start gateway:', error as Error)
    return { success: false, message: this.sanitizeDiagnostic(errorMessage) }
  }
}
```

不得改变上述端口分支的现有返回文案。

- [ ] **步骤 5：固定 Gateway 配置路径并限制诊断缓冲区**

Gateway spawn env 改为：

```ts
env: {
  ...shellEnv,
  OPENCLAW_CONFIG_PATH: openclawConfigPath(),
  OPENCLAW_NO_AUTO_UPDATE: '1'
}
```

将 Gateway 的 stdout/stderr 累积改为复用任务 1 的有界追加逻辑；到达 1 MiB 后继续排空流但
丢弃后续内容。生成早退和超时诊断时：

1. 每个 stream 最多取前五个非空行；
2. 合并后调用 `sanitizeDiagnostic`；
3. 只把脱敏、2000 字符以内的内容放进 Error；
4. 不改变 30 秒健康检查和 1 秒轮询间隔。

- [ ] **步骤 6：运行主进程与 Renderer 定向测试**

运行：

```bash
pnpm exec vitest run --project main src/main/services/__tests__/OpenClawService.test.ts
pnpm exec vitest run --project renderer src/renderer/pages/code/hooks/__tests__/useOpenClawGatewayController.test.ts
pnpm typecheck:node
pnpm typecheck:web
```

预期：全部退出 0；主进程测试证明预检早于端口处理，Renderer 测试证明同步失败不会启动。

- [ ] **步骤 7：运行提交前门禁并提交**

运行：

```bash
pnpm build:check
git status --short
git add src/main/services/OpenClawService.ts src/main/services/__tests__/OpenClawService.test.ts src/renderer/pages/code/hooks/__tests__/useOpenClawGatewayController.test.ts
git commit -S --signoff -m "fix(openclaw): preflight config before gateway launch"
git cat-file commit HEAD | grep '^gpgsig '
git show -s --format='%B' HEAD | grep '^Signed-off-by:'
```

预期：门禁退出 0；提交不包含 Hook 业务文件或共享 IPC 文件。

---

### 任务 4：全量验证与范围审计

**文件：**

- 验证：上述实现、测试、locale 与同步生成的主进程 translate 文件
- 对照：`docs/superpowers/specs/2026-08-03-openclaw-config-preflight-design.md`

- [ ] **步骤 1：运行格式化并检查写入范围**

运行：

```bash
pnpm format
git status --short
git diff --stat origin/main...HEAD
```

预期：格式化退出 0；只出现计划列出的文件。`src/main/i18n/translate/*.json` 只允许出现
`i18n:sync` 生成的新 key。若格式化修改这些文件，将变更并入最近的对应提交；不得提交其他
文件。

- [ ] **步骤 2：运行项目要求的完整验证**

运行：

```bash
pnpm lint
pnpm test
pnpm build:check
pnpm test:lint
```

预期：四个命令均退出 0。若当前路径因嵌套 `.claude/worktrees` 被 ESLint 扫描而失败，停止并
切换到外部独立 worktree 重跑；不得删除、移动或格式化其他 worktree。

- [ ] **步骤 3：运行故障专项测试并检查关键断言**

运行：

```bash
pnpm exec vitest run --project main src/main/services/__tests__/OpenClawService.test.ts
pnpm exec vitest run --project renderer src/renderer/pages/code/hooks/__tests__/useOpenClawGatewayController.test.ts
```

必须确认测试输出中以下用例均 PASS：

- 重建全部 `cherry-*` 且保留外部配置；
- `ssrfPolicy` 外部失败不覆盖正式文件；
- Cherry 路径失败提示二进制不兼容；
- 候选同目录、清理完成、正式文件 `0600`；
- schema、validate、gateway 使用设计规定的配置路径；
- 正式配置无效时不检查端口、不停止旧 Gateway；
- Issue、原始命令和 Gateway 输出秘密均不泄露；
- Renderer 同步失败时不调用 `start_gateway`。

- [ ] **步骤 4：审计范围与禁止项**

运行：

```bash
git diff --name-only origin/main...HEAD
git diff origin/main...HEAD -- src/shared src/main/utils/processRunner.ts src/main/services/BinaryManager.ts src/renderer/pages/code/hooks/useOpenClawGatewayController.ts
rg -n "doctor --fix|JSON5|config_changed|atomicWriteIfUnchanged" src/main/services/OpenClawService.ts
```

预期：

- 第一条只列出设计、计划、三个实现/测试文件、两个主 locale 和 10 个同步 translate 文件；
- 第二条没有实现 diff；
- 第三条没有匹配；
- 没有新增公共类型、IPC Route、配置路径设置或自动修复逻辑。

- [ ] **步骤 5：验证提交签名和工作区状态**

运行：

```bash
git log --format='%H %s%n%B' origin/main..HEAD
git rev-list origin/main..HEAD | while read commit; do git cat-file commit "$commit" | grep -q '^gpgsig '; done
git rev-list origin/main..HEAD | while read commit; do git show -s --format='%B' "$commit" | grep -q '^Signed-off-by:'; done
git status --short
```

预期：所有实现提交均有 `gpgsig` 和 `Signed-off-by`；工作区干净。如果格式化在步骤 1 产生了
尚未提交的限定范围变更，先重跑相关定向测试与 `pnpm build:check`，再使用：

```bash
git add src/main/services/OpenClawService.ts src/main/services/__tests__/OpenClawService.test.ts src/main/i18n/locales/en-us.json src/main/i18n/locales/zh-cn.json src/main/i18n/translate src/renderer/pages/code/hooks/__tests__/useOpenClawGatewayController.test.ts
git commit -S --signoff -m "chore(openclaw): format preflight changes"
```

最后再次确认 `git status --short` 无输出。
