# OAuth 登录原子恢复实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（- [ ]）语法来跟踪进度。

**目标：** 用主进程拥有的原子 oauth.sign_in.attach 操作替换 renderer 的 has_token → is_signing_in → sign_in 竞态，使 OAuth 完成或取消恰好发生在恢复窗口时，界面也不会误开新浏览器或卡死。

**架构：** OAuthRuntimeService 在同步读取 activeSignIns 时捕获已有 promise；IPC 只返回 completed 或 not-found，绝不启动新流程。Renderer 在 not-found 后二次读取 token，以区分“刚完成”与“刚取消”，只有显式点击登录按钮才能调用 oauth.sign_in。

**技术栈：** TypeScript、Electron IpcApi、Zod、React、Vitest、Testing Library。

---

## 实施约束

- 工作目录固定为 /Users/gujiaming/.config/superpowers/worktrees/cherry-studio/fix-codex-oauth-retry。
- 不保留 oauth.is_signing_in 作为兼容层；仓库内没有其他调用方，保留会形成两个恢复协议。
- oauth.sign_in.attach 只 join，不调用 signIn()，不打开浏览器，不创建 transport。
- 不改变 abort 边界；“token exchange/persist 阶段能否取消”不属于本修复。
- 用户明确要求不跑全量测试。因此不运行 pnpm test、pnpm lint、pnpm build:check；后者内部包含全量 pnpm test。用定向 Vitest、pnpm typecheck、i18n/文档检查及变更文件局部 lint/format 代替。
- 所有提交使用 git commit -S --signoff；禁止 force-push。

## 任务 0：保存已确认设计与执行计划

**文件：**

- 修改：docs/superpowers/specs/2026-08-11-oauth-sign-in-attach-design.md
- 新增：docs/superpowers/plans/2026-08-11-oauth-sign-in-attach.md

- [ ] 复核设计修正只是在用户“不跑全量测试”的约束下移除互相矛盾的 build:check 要求，功能契约没有变化。
- [ ] 暂存并提交文档：

~~~bash
git add docs/superpowers/specs/2026-08-11-oauth-sign-in-attach-design.md docs/superpowers/plans/2026-08-11-oauth-sign-in-attach.md
git diff --cached --check
git commit -S --signoff -m "docs(oauth): plan atomic sign-in attach"
git cat-file commit HEAD | rg "^(gpgsig|Signed-off-by:)"
~~~

## 任务 1：为主进程增加原子 attach 协议

**文件：**

- 修改：src/main/services/oauth/runtime/__tests__/OAuthRuntimeService.test.ts
- 修改：src/main/ipc/handlers/__tests__/oauth.test.ts
- 修改：src/shared/ipc/schemas/oauth.ts
- 修改：src/main/services/oauth/runtime/OAuthRuntimeService.ts
- 修改：src/main/ipc/handlers/oauth.ts

### 1.1 先写会失败的 runtime 契约测试

- [ ] 把现有 exposes and reuses an active sign-in flow 改成原子 attach 测试。测试必须捕获一个已存在的 sign-in promise，并证明 attach 不会二次 acquire transport：

~~~ts
it('atomically attaches to an active sign-in without starting another flow', async () => {
  let resolveCode: (code: string) => void = () => {}
  h.transportMock.waitForAuthorizationCode.mockImplementationOnce(
    () =>
      new Promise<string>((resolve) => {
        resolveCode = resolve
      })
  )
  h.clientMock.exchangeCode.mockResolvedValue({ access_token: 'at', refresh_token: 'rt', expires_in: 3600 })

  const signIn = service.signIn('codex')
  const attached = service.joinActiveSignIn('codex')

  expect(h.transportMock.tryAcquire).toHaveBeenCalledTimes(1)
  await vi.waitFor(() => expect(h.transportMock.waitForAuthorizationCode).toHaveBeenCalledTimes(1))

  resolveCode('auth-code')
  await expect(attached).resolves.toEqual({ status: 'completed', account: { accountId: null } })
  await expect(signIn).resolves.toEqual({ accountId: null })
})
~~~

- [ ] 增加无活动流程测试，明确 not-found 不会启动登录：

~~~ts
it('returns not-found without starting a sign-in when no flow is active', async () => {
  await expect(service.joinActiveSignIn('codex')).resolves.toEqual({ status: 'not-found' })
  expect(h.transportMock.tryAcquire).not.toHaveBeenCalled()
  expect(h.transportMock.waitForAuthorizationCode).not.toHaveBeenCalled()
})
~~~

- [ ] 把取消测试中对 isSigningIn() 的断言替换为 joinActiveSignIn() 的状态断言：取消前捕获的 join 与原 promise 一起收到 OAuthSignInCancelledError；取消完成后新的 join 返回 not-found。

- [ ] 运行红灯测试：

~~~bash
pnpm exec vitest run --project main src/main/services/oauth/runtime/__tests__/OAuthRuntimeService.test.ts
~~~

预期：失败，指出 service.joinActiveSignIn is not a function。这证明测试会捕获缺失的原子操作。

### 1.2 先写会失败的 IPC 路由测试

- [ ] 在 handler test 的 runtimeService mock 中增加：

~~~ts
joinActiveSignIn: vi.fn(() =>
  Promise.resolve({ status: 'completed' as const, account: { accountId: 'acc-1' } })
),
cancelSignIn: vi.fn(() => Promise.resolve()),
~~~

- [ ] 增加 attach 委派测试：

~~~ts
it('dispatches sign_in.attach to the active main-process sign-in', async () => {
  await expect(oauthHandlers['oauth.sign_in.attach'](provider, ctx)).resolves.toEqual({
    status: 'completed',
    account: { accountId: 'acc-1' }
  })
  expect(runtimeService.joinActiveSignIn).toHaveBeenCalledWith('codex')
})
~~~

- [ ] 运行红灯测试：

~~~bash
pnpm exec vitest run --project main src/main/ipc/handlers/__tests__/oauth.test.ts
~~~

预期：失败，因为 oauth.sign_in.attach 尚未注册。

### 1.3 实现 schema、runtime 与 handler

- [ ] 在 src/shared/ipc/schemas/oauth.ts 的 oauthAccountSchema 后定义封闭返回联合，并用 attach 替换 is_signing_in：

~~~ts
const signInAttachResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('not-found') }),
  z.object({ status: z.literal('completed'), account: oauthAccountSchema })
])

export const oauthRequestSchemas = {
  'oauth.sign_in': defineRoute({ input: providerInput, output: oauthAccountSchema }),
  'oauth.sign_in.attach': defineRoute({ input: providerInput, output: signInAttachResultSchema }),
  // remaining routes unchanged
}
~~~

- [ ] 在 OAuthRuntimeService.signIn 之后添加同步捕获、异步等待的方法，并删除无调用方的 isSigningIn：

~~~ts
public joinActiveSignIn = async (
  providerId: string
): Promise<{ status: 'not-found' } | { status: 'completed'; account: OAuthAccount }> => {
  this.getDefinition(providerId)
  const activeSignIn = this.activeSignIns.get(providerId)
  if (!activeSignIn) return { status: 'not-found' }

  return { status: 'completed', account: await activeSignIn.promise }
}
~~~

原子性来自第一次 await 前的 Map.get() 和局部 promise 捕获；即使原流程随后从 map 清理，attach 仍等待同一个 promise。

- [ ] 在 src/main/ipc/handlers/oauth.ts 抽出两个登录路由共享的取消错误映射，保证 attach 捕获到取消时 renderer 仍收到稳定错误码：

~~~ts
const mapSignInCancellation = async <T>(request: Promise<T>): Promise<T> => {
  try {
    return await request
  } catch (error) {
    if (error instanceof OAuthSignInCancelledError) {
      throw new IpcError(oauthErrorCodes.SIGN_IN_CANCELLED, error.message)
    }
    throw error
  }
}

export const oauthHandlers: IpcHandlersFor<typeof oauthRequestSchemas> = {
  'oauth.sign_in': ({ providerId }) => mapSignInCancellation(runtime().signIn(providerId)),
  'oauth.sign_in.attach': ({ providerId }) => mapSignInCancellation(runtime().joinActiveSignIn(providerId)),
  // remaining handlers unchanged
}
~~~

- [ ] 搜索并确认旧协议只剩待更新的 renderer/test 调用方：

~~~bash
rg -n "oauth\\.is_signing_in|isSigningIn" src
~~~

预期：仅 LoginOauthPanel.tsx 和它的测试暂时命中；主进程代码不再命中。

### 1.4 让主进程测试转绿

- [ ] 运行两个定向测试文件：

~~~bash
pnpm exec vitest run --project main src/main/services/oauth/runtime/__tests__/OAuthRuntimeService.test.ts src/main/ipc/handlers/__tests__/oauth.test.ts
~~~

预期：两个文件全部通过。

### 1.5 补齐取消映射的有效回归测试

- [ ] 在 handler test 增加 OAuthSignInCancelledError、IpcError、oauthErrorCodes imports。

- [ ] 为显式登录与 attach 各加一条错误映射断言。使用 mockRejectedValueOnce，避免污染其他测试：

~~~ts
it('maps a sign-in cancellation to the stable IPC error code', async () => {
  runtimeService.signIn.mockRejectedValueOnce(new OAuthSignInCancelledError('codex'))

  const error = await oauthHandlers['oauth.sign_in'](provider, ctx).catch((value: unknown) => value)

  expect(error).toBeInstanceOf(IpcError)
  expect(error).toMatchObject({ code: oauthErrorCodes.SIGN_IN_CANCELLED })
})

it('maps an attached sign-in cancellation to the stable IPC error code', async () => {
  runtimeService.joinActiveSignIn.mockRejectedValueOnce(new OAuthSignInCancelledError('codex'))

  const error = await oauthHandlers['oauth.sign_in.attach'](provider, ctx).catch((value: unknown) => value)

  expect(error).toBeInstanceOf(IpcError)
  expect(error).toMatchObject({ code: oauthErrorCodes.SIGN_IN_CANCELLED })
})
~~~

- [ ] 由于显式登录的映射在当前分支已经存在，先做一次 mutation check 证明新增测试不是行为固定测试：临时把 mapSignInCancellation 的取消分支改为 throw error，运行下面命令并确认两条测试失败；立即恢复原分支，再运行并确认通过。临时 mutation 不得提交。

~~~bash
pnpm exec vitest run --project main src/main/ipc/handlers/__tests__/oauth.test.ts -t "maps .* cancellation"
~~~

预期：mutation 时失败；恢复后通过。

### 1.6 局部检查并提交主进程协议

- [ ] 运行变更文件局部检查：

~~~bash
pnpm exec eslint src/shared/ipc/schemas/oauth.ts src/main/services/oauth/runtime/OAuthRuntimeService.ts src/main/services/oauth/runtime/__tests__/OAuthRuntimeService.test.ts src/main/ipc/handlers/oauth.ts src/main/ipc/handlers/__tests__/oauth.test.ts
pnpm exec biome check src/shared/ipc/schemas/oauth.ts src/main/services/oauth/runtime/OAuthRuntimeService.ts src/main/services/oauth/runtime/__tests__/OAuthRuntimeService.test.ts src/main/ipc/handlers/oauth.ts src/main/ipc/handlers/__tests__/oauth.test.ts
~~~

预期：退出码均为 0。

- [ ] 暂存并复核只包含任务 1 文件：

~~~bash
git add src/shared/ipc/schemas/oauth.ts src/main/services/oauth/runtime/OAuthRuntimeService.ts src/main/services/oauth/runtime/__tests__/OAuthRuntimeService.test.ts src/main/ipc/handlers/oauth.ts src/main/ipc/handlers/__tests__/oauth.test.ts
git diff --cached --check
git diff --cached --stat
~~~

- [ ] 创建签名且 DCO sign-off 的聚焦提交，并验证签名头：

~~~bash
git commit -S --signoff -m "fix(oauth): add atomic sign-in attach"
git cat-file commit HEAD | rg "^(gpgsig|Signed-off-by:)"
~~~

## 任务 2：renderer 只 attach，不隐式启动登录

**文件：**

- 修改：src/renderer/pages/settings/ProviderSettings/ProviderSpecific/__tests__/LoginOauthPanel.test.tsx
- 修改：src/renderer/pages/settings/ProviderSettings/ProviderSpecific/LoginOauthPanel.tsx

### 2.1 先把测试迁移到新协议并加入竞态回归

- [ ] 所有“无活动登录”的测试 mock 用下面分支替换 oauth.is_signing_in: false：

~~~ts
if (channel === 'oauth.sign_in.attach') return Promise.resolve({ status: 'not-found' })
~~~

- [ ] “恢复等待态”测试让 attach promise 保持 pending，并明确禁止 mount 自动调用 oauth.sign_in：

~~~ts
it('restores the waiting state by attaching to an active main-process sign-in', async () => {
  requestMock.mockImplementation((channel: string) => {
    if (channel === 'oauth.has_token') return Promise.resolve(false)
    if (channel === 'oauth.sign_in.attach') return new Promise(() => {})
    if (channel === 'oauth.sign_in') throw new Error('mount must not start sign-in')
    throw new Error('unexpected channel: ' + channel)
  })

  render(<LoginOauthPanel providerId="codex" i18nNs="codex" />)

  expect(await screen.findByText('settings.provider.codex.signing_in')).toBeDisabled()
  expect(screen.getByRole('button', { name: 'common.cancel' })).toBeEnabled()
  expect(requestMock).toHaveBeenCalledWith('oauth.sign_in.attach', { providerId: 'codex' })
  expect(requestMock).not.toHaveBeenCalledWith('oauth.sign_in', expect.anything())
})
~~~

- [ ] 增加“首次读 token 后刚完成”的测试。第一次 has_token 返回 false，attach 返回 not-found，第二次返回 true；必须显示已登录、同步 renderer provider cache，且不调用 oauth.sign_in：

~~~ts
it('recovers completion between the first token read and attach without starting a new flow', async () => {
  let tokenRead = 0
  requestMock.mockImplementation((channel: string) => {
    if (channel === 'oauth.has_token') {
      tokenRead += 1
      return Promise.resolve(tokenRead === 2)
    }
    if (channel === 'oauth.sign_in.attach') return Promise.resolve({ status: 'not-found' })
    if (channel === 'oauth.get_account') return Promise.resolve({ accountId: 'acc-1' })
    if (channel === 'oauth.sign_in') throw new Error('recovery must not start sign-in')
    throw new Error('unexpected channel: ' + channel)
  })

  render(<LoginOauthPanel providerId="codex" i18nNs="codex" showAccountId />)

  expect(await screen.findByText('settings.provider.codex.logged_in')).toBeInTheDocument()
  expect(requestMock).toHaveBeenCalledTimes(4)
  expect(updateProviderMock).toHaveBeenCalledWith({ isEnabled: true })
  expect(requestMock).not.toHaveBeenCalledWith('oauth.sign_in', expect.anything())
})
~~~

- [ ] 增加“首次读 token 后刚取消”的测试。两次 has_token 都为 false，attach 返回 not-found；必须回到可重试状态，不弹失败 toast，也不启动登录：

~~~ts
it('recovers cancellation between the first token read and attach without a failure toast', async () => {
  requestMock.mockImplementation((channel: string) => {
    if (channel === 'oauth.has_token') return Promise.resolve(false)
    if (channel === 'oauth.sign_in.attach') return Promise.resolve({ status: 'not-found' })
    if (channel === 'oauth.sign_in') throw new Error('recovery must not start sign-in')
    throw new Error('unexpected channel: ' + channel)
  })

  render(<LoginOauthPanel providerId="codex" i18nNs="codex" />)

  expect(await screen.findByRole('button', { name: 'settings.provider.codex.sign_in_button' })).toBeEnabled()
  expect(requestMock).toHaveBeenCalledTimes(3)
  expect(toast.error).not.toHaveBeenCalled()
  expect(requestMock).not.toHaveBeenCalledWith('oauth.sign_in', expect.anything())
})
~~~

- [ ] 运行红灯测试：

~~~bash
pnpm exec vitest run --project renderer src/renderer/pages/settings/ProviderSettings/ProviderSpecific/__tests__/LoginOauthPanel.test.tsx
~~~

预期：旧组件仍调用 oauth.is_signing_in，至少新恢复测试失败；若自动 sign-in 被触发，测试会以显式错误失败。

### 2.2 实现 renderer 的 attach/二次 token 读取

- [ ] 把登录成功后的状态与 provider cache 同步提取为 applySignInSuccess，供显式登录、attach 完成、二次 token 发现完成三条路径复用：

~~~ts
const applySignInSuccess = useCallback(
  async (account: { accountId: string | null }) => {
    if (!mountedRef.current) return
    setLoggedIn(true)
    setAccountId(account.accountId)
    await updateProvider({ isEnabled: true })
    if (mountedRef.current) toast.success(t(ns + '.sign_in_success'))
  },
  [ns, t, updateProvider]
)
~~~

- [ ] 保留 signInRequestRef 的本窗口防重复语义，但把 observeSignIn 重命名为 startSignIn；它是组件内唯一调用 oauth.sign_in 的函数，并调用 applySignInSuccess(account)。

- [ ] 新增 attachActiveSignIn。其完整状态机必须是：

~~~ts
const attachActiveSignIn = useCallback(async () => {
  setSigningIn(true)
  try {
    const result = await ipcApi.request('oauth.sign_in.attach', { providerId })
    if (result.status === 'completed') {
      await applySignInSuccess(result.account)
      return
    }

    const hasToken = await ipcApi.request('oauth.has_token', { providerId })
    if (!mountedRef.current) return
    if (hasToken) {
      const account = showAccountId
        ? await ipcApi.request('oauth.get_account', { providerId })
        : { accountId: null }
      await applySignInSuccess(account)
      return
    }

    setLoggedIn(false)
    setAccountId(null)
  } catch (error) {
    if (error instanceof IpcError && error.code === oauthErrorCodes.SIGN_IN_CANCELLED) return
    if (!mountedRef.current) return
    logger.error(providerId + ' attached sign-in failed', error as Error)
    toast.error(t(ns + '.sign_in_failed'))
  } finally {
    if (mountedRef.current) setSigningIn(false)
  }
}, [applySignInSuccess, ns, providerId, showAccountId, t])
~~~

- [ ] 把 refreshStatus 的无 token 分支改为 attach，不再调用 oauth.is_signing_in 或 startSignIn：

~~~ts
setLoggedIn(false)
setAccountId(null)
await attachActiveSignIn()
~~~

- [ ] 登录按钮的 click handler 只调用 startSignIn()。

- [ ] 搜索旧协议并确认完全移除：

~~~bash
rg -n "oauth\\.is_signing_in|isSigningIn" src
~~~

预期：无输出，退出码 1。

### 2.3 让 renderer 测试转绿

- [ ] 运行定向 renderer 测试：

~~~bash
pnpm exec vitest run --project renderer src/renderer/pages/settings/ProviderSettings/ProviderSpecific/__tests__/LoginOauthPanel.test.tsx
~~~

预期：全部通过，且两条竞态测试分别覆盖第二次 token 为 true/false 的契约。

- [ ] 运行主进程与 renderer 三个受影响测试文件，防止 schema 调整造成交叉回归：

~~~bash
pnpm exec vitest run --project main src/main/services/oauth/runtime/__tests__/OAuthRuntimeService.test.ts src/main/ipc/handlers/__tests__/oauth.test.ts
pnpm exec vitest run --project renderer src/renderer/pages/settings/ProviderSettings/ProviderSpecific/__tests__/LoginOauthPanel.test.tsx
~~~

预期：全部通过。

### 2.4 局部检查并提交 renderer 修复

- [ ] 运行变更文件局部检查：

~~~bash
pnpm exec eslint src/renderer/pages/settings/ProviderSettings/ProviderSpecific/LoginOauthPanel.tsx src/renderer/pages/settings/ProviderSettings/ProviderSpecific/__tests__/LoginOauthPanel.test.tsx
pnpm exec biome check src/renderer/pages/settings/ProviderSettings/ProviderSpecific/LoginOauthPanel.tsx src/renderer/pages/settings/ProviderSettings/ProviderSpecific/__tests__/LoginOauthPanel.test.tsx
~~~

预期：退出码均为 0。

- [ ] 暂存、复核并提交：

~~~bash
git add src/renderer/pages/settings/ProviderSettings/ProviderSpecific/LoginOauthPanel.tsx src/renderer/pages/settings/ProviderSettings/ProviderSpecific/__tests__/LoginOauthPanel.test.tsx
git diff --cached --check
git diff --cached --stat
git commit -S --signoff -m "fix(oauth): restore sign-in through atomic attach"
git cat-file commit HEAD | rg "^(gpgsig|Signed-off-by:)"
~~~

## 任务 3：受约束的最终验证与 PR 更新准备

**文件：**

- 验证：任务 1、2 的 7 个业务/测试文件
- 验证：docs/superpowers/specs/2026-08-11-oauth-sign-in-attach-design.md
- 验证：docs/superpowers/plans/2026-08-11-oauth-sign-in-attach.md

### 3.1 跑允许范围内的静态检查

- [ ] 类型检查共享 IPC、main 与 renderer 的编译边界：

~~~bash
pnpm typecheck
~~~

预期：退出码 0。

- [ ] 跑不触发全量 Vitest 的仓库检查：

~~~bash
pnpm i18n:check
pnpm docs:check-links
~~~

预期：退出码均为 0。本修复没有新增用户文案，因此不应产生 locale diff。

- [ ] 对全部变更文件做一次局部格式与 lint 复核：

~~~bash
pnpm exec eslint src/shared/ipc/schemas/oauth.ts src/main/services/oauth/runtime/OAuthRuntimeService.ts src/main/services/oauth/runtime/__tests__/OAuthRuntimeService.test.ts src/main/ipc/handlers/oauth.ts src/main/ipc/handlers/__tests__/oauth.test.ts src/renderer/pages/settings/ProviderSettings/ProviderSpecific/LoginOauthPanel.tsx src/renderer/pages/settings/ProviderSettings/ProviderSpecific/__tests__/LoginOauthPanel.test.tsx
pnpm exec biome check src/shared/ipc/schemas/oauth.ts src/main/services/oauth/runtime/OAuthRuntimeService.ts src/main/services/oauth/runtime/__tests__/OAuthRuntimeService.test.ts src/main/ipc/handlers/oauth.ts src/main/ipc/handlers/__tests__/oauth.test.ts src/renderer/pages/settings/ProviderSettings/ProviderSpecific/LoginOauthPanel.tsx src/renderer/pages/settings/ProviderSettings/ProviderSpecific/__tests__/LoginOauthPanel.test.tsx
git diff --check
~~~

预期：退出码均为 0。

### 3.2 在 tracked Electron 实例中手工验证

- [ ] 按 cherry-electron-dev 的实例接管规则读取 .context/cherry-electron-dev/instance.json；由于主进程代码变化，停止该实例并用同一 worktree、同一 CDP 端口重启，不创建第二个实例。
- [ ] 验证显式登录：点击“登录”，只打开一个 OpenAI 授权页，按钮显示“等待浏览器授权…”，取消按钮可用。
- [ ] 验证 remount attach：保持主进程登录等待，切换到其他 provider 再切回 Codex。确认界面恢复等待态，但不会自动打开第二个授权页。
- [ ] 验证取消与立即重试：点击 Cherry Studio 的“取消”，确认恢复可点击登录按钮且无“登录失败”toast；立即再点登录，确认能发起新的授权页。
- [ ] 保持实例运行，并记录验证时的窗口状态、CDP/runner 标识及关键截图路径。竞态的“完成/取消恰好发生在 attach 前”由定向单测确定性覆盖，手工测试不靠时间碰撞模拟。

### 3.3 最终 Git/PR 状态复核

- [ ] 检查提交、签名、工作树和 diff 范围：

~~~bash
git status --short --branch
git log --show-signature --format=fuller -3
git diff origin/codex/fix-codex-oauth-retry...HEAD --check
git diff origin/codex/fix-codex-oauth-retry...HEAD --stat
~~~

预期：没有未提交业务代码；每个新提交都有有效签名和 Signed-off-by；diff 只包含设计/计划文档及 OAuth 相关文件。

- [ ] 明确记录未运行项：pnpm test、pnpm lint、pnpm build:check 均因用户要求“不跑全量测试”而跳过，不能写成已通过。
- [ ] 在获得用户对推送/更新 PR 的明确授权后，普通 push 当前分支；禁止 force-push。随后用 gh pr view 18367 --json statusCheckRollup,reviewDecision,url 检查远端状态，但不擅自回复或 resolve reviewer threads。
