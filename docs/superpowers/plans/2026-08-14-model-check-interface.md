# 模型检测界面实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 将服务商设置中的单模型连通性检测和全模型健康检测合并为模型列表工具栏中的“模型检测”入口，同时保留 v2 单模型反馈语义、恢复 v1.9 全模型行内结果，并支持按 API Key 查看失败和直接启停密钥。

**架构：** 在 Provider Settings 功能层提升现有 API Key 上下文，使认证表单和模型检测 runner 共享同一份待提交凭据；保留单模型与全模型两个 runner，由模型列表健康上下文统一协调弹窗、忙碌态和结果。全模型结果继续存放在结果上下文中，由虚拟列表行订阅并通过 Portal Popover 展示详情；不改 IPC、主进程探测、数据库或公共 UI 组件。

**技术栈：** React 19、TypeScript、Vitest、Testing Library、i18next、`@cherrystudio/ui`（Dialog、Combobox、SegmentedControl、Popover、Switch）、DataApi Provider hooks。

---

## 文件结构

### 新建

- `src/renderer/pages/settings/ProviderSettings/ModelList/ProviderModelCheck.tsx`：模型列表工具栏的唯一“模型检测”按钮及统一弹窗宿主。
- `src/renderer/pages/settings/ProviderSettings/ModelList/ModelCheckDialog.tsx`：单模型/所有模型表单、单模型失败报告和启动交互。
- `src/renderer/pages/settings/ProviderSettings/ModelList/ApiKeyCheckResults.tsx`：弹窗与行内 Popover 共用的逐 Key 结果和启停开关。
- `src/renderer/pages/settings/ProviderSettings/ModelList/ModelCheckStatus.tsx`：固定高度模型行中的状态按钮和 Portal Popover。
- `src/renderer/pages/settings/ProviderSettings/ModelList/__tests__/ProviderModelCheck.test.tsx`：唯一入口、中文/英文文案和忙碌态合同。
- `src/renderer/pages/settings/ProviderSettings/ModelList/__tests__/ModelCheckDialog.test.tsx`：两种模式的表单、默认值、切换和关闭语义。
- `src/renderer/pages/settings/ProviderSettings/ModelList/__tests__/ApiKeyCheckResults.test.tsx`：逐 Key 状态、完整错误和启停行为。
- `src/renderer/pages/settings/ProviderSettings/ModelList/__tests__/ModelCheckStatus.test.tsx`：检查中/通过/部分通过/失败/跳过的行内呈现和 Popover。
- `v2-refactor-temp/docs/breaking-changes/2026-08-14-model-check-moved.md`：记录用户可见的入口移动和旧侧栏移除。

### 修改

- `src/renderer/pages/settings/ProviderSettings/ProviderSetting.tsx`：把 `ApiKeyProvider` 提升到认证区与模型列表的共同父级。
- `src/renderer/pages/settings/ProviderSettings/ConnectionSettings/AuthenticationSection.tsx`：消费上层 API Key 上下文，不再自行创建。
- `src/renderer/pages/settings/ProviderSettings/ConnectionSettings/AuthenticationSectionContent.tsx`：移除单模型检测 hook 和弹窗。
- `src/renderer/pages/settings/ProviderSettings/ConnectionSettings/ApiKey.tsx`：移除输入框右侧的 Activity 检测按钮和检测状态 props。
- `src/renderer/pages/settings/ProviderSettings/hooks/providerSetting/useProviderConnectionCheck.ts`：改为多 Key 单模型 runner，保存失败留在弹窗，全部成功关闭，部分成功仍可自动启用服务商。
- `src/renderer/pages/settings/ProviderSettings/ModelList/useHealthCheck.ts`：改为启动后后台运行的所有模型 runner，关闭弹窗、增量更新列表并汇总 toast。
- `src/renderer/pages/settings/ProviderSettings/ModelList/modelListHealthContext.tsx`：协调统一弹窗、两套 runner、API Key mutation 和分离的 run/results 订阅。
- `src/renderer/pages/settings/ProviderSettings/ModelList/checkModelsHealth.ts`：逐 Key 检测携带稳定 Key 身份与标签。
- `src/renderer/pages/settings/ProviderSettings/types/healthCheck.ts`：增加检测凭据、Key 选择、单模型结果需要的判别联合。
- `src/renderer/types/healthCheck.ts`：删除已被功能内强类型完全取代的旧 v1 健康检测类型。
- `src/renderer/pages/settings/ProviderSettings/utils/healthCheck.ts`：解析 Key 范围、状态摘要、跳过原因和结果统计。
- `src/renderer/pages/settings/ProviderSettings/ModelList/ModelList.tsx`：将唯一入口放到“获取模型列表”前，并用统一忙碌态禁用模型 mutation。
- `src/renderer/pages/settings/ProviderSettings/ModelList/ProviderModelList.tsx`：区分模型 mutation 禁用和仍可使用的搜索/筛选/分组展开。
- `src/renderer/pages/settings/ProviderSettings/ModelList/ModelListHeader.tsx`：检测期间仍允许搜索、筛选和展开折叠。
- `src/renderer/pages/settings/ProviderSettings/ModelList/ModelListSections.tsx`：把结果订阅交给每个模型行，保持 44px 估算高度。
- `src/renderer/pages/settings/ProviderSettings/ModelList/ModelListItem.tsx`：渲染行内状态并在检测期间禁用编辑/删除。
- `src/renderer/pages/settings/ProviderSettings/ModelList/useProviderModelList.ts`：成功删除后由模型集合变化修剪结果，失败时保留模型和结果。
- `src/renderer/pages/settings/ProviderSettings/ModelList/index.ts`：仅重导出新的窄模型检测 API。
- `src/renderer/i18n/locales/zh-cn.json`、`src/renderer/i18n/locales/en-us.json`：加入“模型检测”及新增状态/表单文案；随后由 `pnpm i18n:sync` 同步键集合。
- 现有 Provider Settings 测试：按任务更新为行为合同，移除只固定旧入口/旧弹窗实现的断言。

### 删除

- `src/renderer/pages/settings/ProviderSettings/ModelList/HealthCheckDrawer.tsx`：所有模型配置移入统一 Dialog，结果移入模型行。
- `src/renderer/pages/settings/ProviderSettings/ModelList/ProviderModelHealthCheck.tsx`：由 `ProviderModelCheck.tsx` 取代。
- `src/renderer/pages/settings/ProviderSettings/ConnectionSettings/ProviderConnectionCheckDrawer.tsx`：由 `ModelCheckDialog.tsx` 取代。
- `src/renderer/pages/settings/ProviderSettings/ConnectionSettings/__tests__/ProviderConnectionCheckDrawer.test.tsx`：旧组件删除后由新弹窗合同测试取代。

## 关键类型与状态合同

在 `src/renderer/pages/settings/ProviderSettings/types/healthCheck.ts` 中使用以下功能内类型；不修改 shared 或 IPC 类型：

```ts
export type ModelCheckKeySelection = { mode: 'all' } | { mode: 'single'; keyId: string }

export type ModelCheckCredential =
  | { kind: 'api-key'; entry: ApiKeyEntry }
  | { kind: 'provider-auth'; id: 'provider-auth'; key: '' }

export type ApiKeyWithStatus = ApiKeyConnectivity & {
  credential: ModelCheckCredential
}
```

`provider-auth` 只用于无需通用 API Key 的本地/OAuth 服务商；传给 `checkApi` 时不设置 `apiKeyOverride`。真实 Key 始终携带 `ApiKeyEntry.id`，因此报告中的开关不会依赖脱敏文本或数组下标。

`ModelWithStatus.kind === 'failed'` 且 `keyResults` 同时含成功与失败时代表“部分通过”；不新增第三个持久状态枚举。当前 Key 是否已停用由最新 `ApiKeyEntry.isEnabled` 派生，停用不擦除本轮探测结果。

---

### 任务 1：提升 API Key 上下文并移除认证行入口依赖

**文件：**
- 修改：`src/renderer/pages/settings/ProviderSettings/ProviderSetting.tsx`
- 修改：`src/renderer/pages/settings/ProviderSettings/ConnectionSettings/AuthenticationSection.tsx`
- 修改：`src/renderer/pages/settings/ProviderSettings/ConnectionSettings/AuthenticationSectionContent.tsx`
- 修改：`src/renderer/pages/settings/ProviderSettings/ConnectionSettings/ApiKey.tsx`
- 测试：`src/renderer/pages/settings/ProviderSettings/__tests__/ProviderSetting.test.tsx`
- 测试：`src/renderer/pages/settings/ProviderSettings/components/__tests__/AuthenticationSection.test.tsx`
- 测试：`src/renderer/pages/settings/ProviderSettings/ConnectionSettings/__tests__/ApiKey.test.tsx`

- [ ] **步骤 1：先写上下文范围和唯一入口的失败测试**

在 `ProviderSetting.test.tsx` 记录 `useProviderApiKey('openai')` 只在页面边界调用一次，且认证区不再收到 `onOpenModelHealthCheck`。在 `AuthenticationSection.test.tsx` 断言组件只渲染 API Key/Host，不创建 `useProviderConnectionCheck` 或旧弹窗。在 `ApiKey.test.tsx` 断言输入行只有显示/隐藏和 Key 管理按钮，不存在 `settings.provider.check` 按钮。

```tsx
expect(useProviderApiKeyMock).toHaveBeenCalledOnce()
expect(authenticationSectionPropsSpy).toHaveBeenCalledWith({
  providerId: 'openai',
  onRequestModelPullGuide: expect.any(Function)
})
expect(screen.queryByRole('button', { name: 'settings.provider.check' })).not.toBeInTheDocument()
```

- [ ] **步骤 2：运行三组测试并确认旧结构使其失败**

运行：

```bash
pnpm exec vitest run --project renderer \
  src/renderer/pages/settings/ProviderSettings/__tests__/ProviderSetting.test.tsx \
  src/renderer/pages/settings/ProviderSettings/components/__tests__/AuthenticationSection.test.tsx \
  src/renderer/pages/settings/ProviderSettings/ConnectionSettings/__tests__/ApiKey.test.tsx
```

预期：FAIL，原因分别是 API Key provider 仍在认证区、认证区仍创建检测 hook/弹窗、输入行仍有检测按钮。

- [ ] **步骤 3：以最小改动提升 Provider**

在 `ProviderSetting.tsx` 的已解析服务商子组件内创建 `const apiKey = useProviderApiKey(providerId)`，并按以下顺序包裹页面内容：

```tsx
<ApiKeyProvider value={apiKey}>
  <ModelListHealthProvider providerId={providerId}>
    <ProviderSettingSections providerId={providerId} isLoginBased={isLoginBasedProvider(provider)} />
  </ModelListHealthProvider>
</ApiKeyProvider>
```

`AuthenticationSection.tsx` 删除 `useProviderApiKey` 和 `ApiKeyProvider`，只保留布局。`AuthenticationSectionContent.tsx` 删除 `useProviderConnectionCheck`、`ProviderConnectionCheckDrawer` 和 `onOpenModelHealthCheck`。`ApiKey.tsx` 删除 `ApiKeyConnectivity`、Activity/Loader 图标、`onOpenConnectionCheck` 与 `requiresApiKey` props。

- [ ] **步骤 4：复跑测试确认通过**

运行任务 1 步骤 2 的命令。预期：三组测试 PASS。

- [ ] **步骤 5：提交上下文重排**

```bash
git add src/renderer/pages/settings/ProviderSettings/ProviderSetting.tsx \
  src/renderer/pages/settings/ProviderSettings/ConnectionSettings/AuthenticationSection.tsx \
  src/renderer/pages/settings/ProviderSettings/ConnectionSettings/AuthenticationSectionContent.tsx \
  src/renderer/pages/settings/ProviderSettings/ConnectionSettings/ApiKey.tsx \
  src/renderer/pages/settings/ProviderSettings/__tests__/ProviderSetting.test.tsx \
  src/renderer/pages/settings/ProviderSettings/components/__tests__/AuthenticationSection.test.tsx \
  src/renderer/pages/settings/ProviderSettings/ConnectionSettings/__tests__/ApiKey.test.tsx
git commit -S --signoff -m "refactor(model-check): share provider credentials"
```

---

### 任务 2：让探测管线保留稳定的 API Key 身份

**文件：**
- 修改：`src/renderer/pages/settings/ProviderSettings/types/healthCheck.ts`
- 删除：`src/renderer/types/healthCheck.ts`
- 修改：`src/renderer/pages/settings/ProviderSettings/utils/healthCheck.ts`
- 修改：`src/renderer/pages/settings/ProviderSettings/ModelList/checkModelsHealth.ts`
- 测试：`src/renderer/pages/settings/ProviderSettings/ModelList/__tests__/checkModelsHealth.test.ts`
- 创建：`src/renderer/pages/settings/ProviderSettings/utils/__tests__/healthCheck.test.ts`

- [ ] **步骤 1：写凭据解析和多 Key 结果的失败测试**

覆盖四个合同：`all` 只返回启用 Key；`single` 按稳定 ID 返回一个启用 Key；需要 Key 但没有启用 Key时返回表单错误；无需 Key 时返回 `provider-auth`。同时把现有多 Key 测试改为断言 ID/标签被原样保留。

```ts
expect(resolveModelCheckCredentials(entries, { mode: 'single', keyId: 'key-2' }, true)).toEqual([
  { kind: 'api-key', entry: entries[1] }
])
expect(resolveModelCheckCredentials([], { mode: 'all' }, false)).toEqual([
  { kind: 'provider-auth', id: 'provider-auth', key: '' }
])
expect(results[0].keyResults[0].credential).toEqual({ kind: 'api-key', entry: entries[0] })
```

- [ ] **步骤 2：运行目标测试确认类型和函数尚不存在**

```bash
pnpm exec vitest run --project renderer \
  src/renderer/pages/settings/ProviderSettings/ModelList/__tests__/checkModelsHealth.test.ts \
  src/renderer/pages/settings/ProviderSettings/utils/__tests__/healthCheck.test.ts
```

预期：FAIL，`ModelCheckCredential` / `resolveModelCheckCredentials` 未定义，checker 仍只返回原始 Key 字符串。

- [ ] **步骤 3：实现功能内凭据类型和解析**

加入“关键类型与状态合同”中的三个类型，并将 `HealthStatus` 枚举移入同一个功能内文件。`resolveModelCheckCredentials` 必须先过滤 `isEnabled`，单 Key ID 不可用时抛出带本地化映射所需错误码的功能内 Error；无通用 Key 的服务商返回 `provider-auth`。确认 `rg '@renderer/types/healthCheck' src/renderer` 无结果后，删除已无消费者的旧 v1 类型文件。

`checkModelWithMultipleKeys` 改为接收 `ModelCheckCredential[]`，每个请求使用：

```ts
const apiKey = credential.kind === 'api-key' ? credential.entry.key : undefined
const { latency } = await checkApi(model.id, { apiKey, timeout, signal })
return { kind: 'ok', credential, status: HealthStatus.SUCCESS, checking: false, latency }
```

失败结果同样携带 `credential` 和完整 `SerializedError`。`checkModelsHealth` 的并发模型语义保持不变。

- [ ] **步骤 4：复跑 checker 与 utility 测试**

运行任务 2 步骤 2 的命令。预期：全部 PASS，并确认 keyless 请求的 `apiKey` 为 `undefined`。

- [ ] **步骤 5：提交稳定 Key 身份**

```bash
git add src/renderer/pages/settings/ProviderSettings/types/healthCheck.ts \
  src/renderer/types/healthCheck.ts \
  src/renderer/pages/settings/ProviderSettings/utils/healthCheck.ts \
  src/renderer/pages/settings/ProviderSettings/ModelList/checkModelsHealth.ts \
  src/renderer/pages/settings/ProviderSettings/ModelList/__tests__/checkModelsHealth.test.ts \
  src/renderer/pages/settings/ProviderSettings/utils/__tests__/healthCheck.test.ts
git commit -S --signoff -m "refactor(model-check): retain api key identity"
```

---

### 任务 3：实现 v2 语义的多 Key 单模型 runner

**文件：**
- 修改：`src/renderer/pages/settings/ProviderSettings/hooks/providerSetting/useProviderConnectionCheck.ts`
- 修改：`src/renderer/pages/settings/ProviderSettings/hooks/providerSetting/__tests__/useProviderConnectionCheck.test.tsx`

- [ ] **步骤 1：把 hook 测试改为结果合同**

删除只断言旧单 Key `checkApi` 调用的测试，新增：

- 保存待提交凭据后 `refetch()`，再按 `ModelCheckKeySelection` 解析最新启用 Key；
- 所有 Key 并发参与；全部成功时关闭并成功 toast；
- 任意 Key 失败时弹窗保持打开并保留每个 Key 的完整结果；
- 至少一个 Key 成功时尝试自动启用服务商；自动启用失败只 warning；
- provider、host、Key 内容（ID/key/label）变化或卸载时 abort 并清空；只有 `isEnabled` 变化时保留结果；
- 用户关闭弹窗不 abort 正在运行的请求。

```ts
expect(commitInputApiKeyNowMock.mock.invocationCallOrder[0]).toBeLessThan(refetchApiKeysMock.mock.invocationCallOrder[0])
expect(checkModelWithMultipleKeysMock).toHaveBeenCalledWith(
  model,
  expect.arrayContaining([
    expect.objectContaining({ kind: 'api-key', entry: expect.objectContaining({ id: 'key-1' }) }),
    expect.objectContaining({ kind: 'api-key', entry: expect.objectContaining({ id: 'key-2' }) })
  ]),
  15000,
  expect.any(AbortSignal)
)
expect(result.current.singleModelResult?.keyResults).toHaveLength(2)
```

- [ ] **步骤 2：运行 hook 测试并确认失败**

```bash
pnpm exec vitest run --project renderer \
  src/renderer/pages/settings/ProviderSettings/hooks/providerSetting/__tests__/useProviderConnectionCheck.test.tsx
```

预期：FAIL，旧 hook 只接收一个原始 Key，并以单一 `ApiKeyConnectivity.error` 表示结果。

- [ ] **步骤 3：实现新的单模型状态机**

保留文件名以减少无关移动，但返回窄表面：

```ts
{
  models,
  apiKeyEntries,
  requiresApiKey,
  isSingleModelChecking,
  singleModelResult,
  resetSingleModelResult,
  startSingleModelCheck(config: { model: Model; keySelection: ModelCheckKeySelection }): Promise<'passed' | 'failed'>
}
```

`requiresApiKey` 仅在通用 API Key 字段可见且服务商不是 `authOptional` 时为 true。凭据内容 fingerprint 使用 `id + key + label`，明确排除 `isEnabled`，保证报告中的启停操作不擦除结果。

启动顺序固定为：set checking → `commitInputApiKeyNow()` → `refetch()` → 解析最新凭据 → `checkModelWithMultipleKeys(..., 15000)` → 分析 keyResults → 至少一个成功时自动启用 → 全部成功返回 `passed`，否则返回 `failed`。保存失败显示现有保存失败 toast，不发探测请求。

- [ ] **步骤 4：复跑单模型 hook 测试**

运行任务 3 步骤 2 的命令。预期：全部 PASS。

- [ ] **步骤 5：提交单模型 runner**

```bash
git add src/renderer/pages/settings/ProviderSettings/hooks/providerSetting/useProviderConnectionCheck.ts \
  src/renderer/pages/settings/ProviderSettings/hooks/providerSetting/__tests__/useProviderConnectionCheck.test.tsx
git commit -S --signoff -m "feat(model-check): check one model across keys"
```

---

### 任务 4：将所有模型 runner 改为后台行内流水线

**文件：**
- 修改：`src/renderer/pages/settings/ProviderSettings/ModelList/useHealthCheck.ts`
- 修改：`src/renderer/pages/settings/ProviderSettings/ModelList/__tests__/useHealthCheck.test.tsx`
- 修改：`src/renderer/pages/settings/ProviderSettings/utils/healthCheck.ts`
- 修改：`src/renderer/pages/settings/ProviderSettings/utils/__tests__/healthCheck.test.ts`

- [ ] **步骤 1：写启动、增量结果和汇总的失败测试**

新测试明确 `startHealthCheck` 在完成凭据保存、状态初始化和启动后台 promise 后立即 resolve，而不是等全部模型完成；检查中的可检测模型为 `checking`，生成/语音模型为 `skipped`；回调按原模型索引增量替换；完成 toast 同时汇总 passed/partial/failed/skipped。

```ts
await expect(result.current.startHealthCheck({
  keySelection: { mode: 'all' },
  isConcurrent: true,
  timeout: 15000
})).resolves.toBe(true)
expect(result.current.isChecking).toBe(true)
expect(result.current.modelStatuses).toEqual([
  expect.objectContaining({ kind: 'checking' }),
  expect.objectContaining({ kind: 'skipped' })
])
expect(toast.success).toHaveBeenCalledWith(expect.stringContaining('partial'))
```

同时保留并强化现有 abort/runId 测试：provider/凭据内容变化和卸载 abort；旧回调不能写入新 provider；Key 启停不清空结果；模型成功删除后由最新模型 ID 集合修剪对应状态。

- [ ] **步骤 2：运行 all-model hook 测试确认失败**

```bash
pnpm exec vitest run --project renderer \
  src/renderer/pages/settings/ProviderSettings/ModelList/__tests__/useHealthCheck.test.tsx \
  src/renderer/pages/settings/ProviderSettings/utils/__tests__/healthCheck.test.ts
```

预期：FAIL，旧 runner 等整个管线完成、关闭旧抽屉时会 abort，且汇总未包含 skipped。

- [ ] **步骤 3：实现后台启动和结果生命周期**

删除 `healthCheckOpen/openHealthCheck/closeHealthCheck`，弹窗开关移交 context。`startHealthCheck` 自行提交并 refetch 最新凭据，验证成功后构建初始状态、设置 `isChecking=true`，以 `void runHealthCheck(...)` 启动后台任务并返回 `true`。保存/表单失败返回 `false`，调用方不关闭 Dialog。

后台任务在 finally 中只为当前 runId 清理 busy；完成时调用：

```ts
toast.success(summarizeHealthResults(finalStatuses, provider.name))
```

`summarizeHealthResults` 增加 skipped 数量并保持部分通过由 Key 结果派生。`resetHealthCheckRun` 只允许非运行时清空结果；显式取消仅发生在 provider 变化或卸载。

- [ ] **步骤 4：复跑 all-model 测试**

运行任务 4 步骤 2 的命令。预期：全部 PASS。

- [ ] **步骤 5：提交所有模型 runner**

```bash
git add src/renderer/pages/settings/ProviderSettings/ModelList/useHealthCheck.ts \
  src/renderer/pages/settings/ProviderSettings/ModelList/__tests__/useHealthCheck.test.tsx \
  src/renderer/pages/settings/ProviderSettings/utils/healthCheck.ts \
  src/renderer/pages/settings/ProviderSettings/utils/__tests__/healthCheck.test.ts
git commit -S --signoff -m "feat(model-check): stream all model results"
```

---

### 任务 5：建立统一上下文、工具栏入口和双模式弹窗

**文件：**
- 创建：`src/renderer/pages/settings/ProviderSettings/ModelList/ProviderModelCheck.tsx`
- 创建：`src/renderer/pages/settings/ProviderSettings/ModelList/ModelCheckDialog.tsx`
- 创建：`src/renderer/pages/settings/ProviderSettings/ModelList/__tests__/ProviderModelCheck.test.tsx`
- 创建：`src/renderer/pages/settings/ProviderSettings/ModelList/__tests__/ModelCheckDialog.test.tsx`
- 修改：`src/renderer/pages/settings/ProviderSettings/ModelList/modelListHealthContext.tsx`
- 修改：`src/renderer/pages/settings/ProviderSettings/ModelList/__tests__/modelListHealthContext.test.tsx`
- 修改：`src/renderer/pages/settings/ProviderSettings/ModelList/ModelList.tsx`
- 修改：`src/renderer/pages/settings/ProviderSettings/ModelList/__tests__/ModelList.test.tsx`
- 修改：`src/renderer/pages/settings/ProviderSettings/ModelList/index.ts`
- 删除：`src/renderer/pages/settings/ProviderSettings/ModelList/ProviderModelHealthCheck.tsx`
- 删除：`src/renderer/pages/settings/ProviderSettings/ModelList/HealthCheckDrawer.tsx`
- 删除：`src/renderer/pages/settings/ProviderSettings/ConnectionSettings/ProviderConnectionCheckDrawer.tsx`
- 删除：`src/renderer/pages/settings/ProviderSettings/ConnectionSettings/__tests__/ProviderConnectionCheckDrawer.test.tsx`

- [ ] **步骤 1：写上下文协调和唯一工具栏入口测试**

`modelListHealthContext.test.tsx` 继续断言逐模型结果变化不重渲染整个 `ProviderModelList`，并新增 `isModelChecking = isSingleModelChecking || isHealthChecking`、单次运行互斥、Dialog open/close 不 abort runner。`ProviderModelCheck.test.tsx` 断言工具栏只有一个带 Activity 的 `模型检测/Model Check` 文本按钮，位于获取模型列表按钮之前；任一 runner 运行时按钮 disabled，所有模型运行时显示 spinner 与 `检测中…/Checking…`。

- [ ] **步骤 2：写双模式表单失败测试**

覆盖：每次打开默认单模型；按名称排序并默认首个可检测模型；不支持模型可见但 disabled 且显示原因；默认所有启用 Key，可切单 Key；keyless 隐藏 Key 控件；切换模式保留各自表单；改模型/Key 只清相应旧结果；所有模型显示 `X 检测 / Y 跳过`、并发开关和 5–60 秒超时；两种模式都显示真实请求费用警告。

```tsx
expect(screen.getByRole('tab', { name: /单个模型|Single model/ })).toHaveAttribute('data-state', 'active')
expect(screen.getByRole('option', { name: /Image Model/ })).toHaveAttribute('aria-disabled', 'true')
expect(screen.getByText(/2.*检测.*1.*跳过|2.*checked.*1.*skipped/)).toBeInTheDocument()
```

- [ ] **步骤 3：运行四组测试确认新组件缺失**

```bash
pnpm exec vitest run --project renderer \
  src/renderer/pages/settings/ProviderSettings/ModelList/__tests__/modelListHealthContext.test.tsx \
  src/renderer/pages/settings/ProviderSettings/ModelList/__tests__/ProviderModelCheck.test.tsx \
  src/renderer/pages/settings/ProviderSettings/ModelList/__tests__/ModelCheckDialog.test.tsx \
  src/renderer/pages/settings/ProviderSettings/ModelList/__tests__/ModelList.test.tsx
```

预期：FAIL，新组件和统一 context API 尚不存在。

- [ ] **步骤 4：扩展 context 的窄表面**

Run context 暴露弹窗/表单需要的状态和命令；Results context 只暴露 `modelStatusMap/modelStatuses`。提供两个 hooks，避免行组件订阅运行控制：

```ts
useModelListHealthRun()
useModelListHealthResults()
```

`ModelListSections` 订阅 results context 并把当前 model 的 `modelStatus` 作为 prop 传给 memo 化的 `ModelListItem`；这样结果 Map 更新只会使 sections 协调层和状态实际变化的行重渲染，不让每个模型行分别订阅整个 Map。

context 负责 `modelCheckOpen`，启动单模型后根据 `'passed'` 关闭或在 `'failed'` 时保持；启动所有模型得到 `true` 后立即关闭。任一 runner 活跃时拒绝第二次启动。API Key toggle 在任务 6 接入。

- [ ] **步骤 5：实现统一 Dialog 表单**

只使用 `@cherrystudio/ui`。模式用 `SegmentedControl` 或 Tabs；模型和单 Key 用 `Combobox` 的 `disabled/description` 原生能力；超时输入在 blur/start 时 clamp 到 5–60，传给 runner 时乘 1000；并发默认 true。Dialog 的 close 只调用 context close，不触发 abort。

单模型失败时保留表单并预留 `ApiKeyCheckResults` 插槽；所有模型不在 Dialog 内渲染进度或结果。Start loading 分别绑定当前模式的准备/运行阶段。

- [ ] **步骤 6：接入工具栏并删除旧 UI**

在 `ModelList.tsx` 的 `ButtonGroup` 中按顺序渲染：`ProviderModelCheck` → `ProviderModelPullReconcile` → Add/Download。删除 API 行/认证区已断开的旧弹窗与 health drawer 文件。`ProviderModelCheck` 的禁用条件使用服务商全部模型数，而不是当前筛选后的 `hasVisibleModels`。

- [ ] **步骤 7：复跑统一入口与弹窗测试**

运行任务 5 步骤 3 的命令。预期：全部 PASS。

- [ ] **步骤 8：提交统一入口**

```bash
git add src/renderer/pages/settings/ProviderSettings/ModelList/ProviderModelCheck.tsx \
  src/renderer/pages/settings/ProviderSettings/ModelList/ModelCheckDialog.tsx \
  src/renderer/pages/settings/ProviderSettings/ModelList/modelListHealthContext.tsx \
  src/renderer/pages/settings/ProviderSettings/ModelList/ModelList.tsx \
  src/renderer/pages/settings/ProviderSettings/ModelList/index.ts \
  src/renderer/pages/settings/ProviderSettings/ModelList/ProviderModelHealthCheck.tsx \
  src/renderer/pages/settings/ProviderSettings/ModelList/HealthCheckDrawer.tsx \
  src/renderer/pages/settings/ProviderSettings/ModelList/__tests__/ProviderModelCheck.test.tsx \
  src/renderer/pages/settings/ProviderSettings/ModelList/__tests__/ModelCheckDialog.test.tsx \
  src/renderer/pages/settings/ProviderSettings/ModelList/__tests__/modelListHealthContext.test.tsx \
  src/renderer/pages/settings/ProviderSettings/ModelList/__tests__/ModelList.test.tsx \
  src/renderer/pages/settings/ProviderSettings/ConnectionSettings/ProviderConnectionCheckDrawer.tsx \
  src/renderer/pages/settings/ProviderSettings/ConnectionSettings/__tests__/ProviderConnectionCheckDrawer.test.tsx
git commit -S --signoff -m "feat(model-check): add unified model check dialog"
```

---

### 任务 6：实现逐 Key 报告、行内状态和密钥启停

**文件：**
- 创建：`src/renderer/pages/settings/ProviderSettings/ModelList/ApiKeyCheckResults.tsx`
- 创建：`src/renderer/pages/settings/ProviderSettings/ModelList/ModelCheckStatus.tsx`
- 创建：`src/renderer/pages/settings/ProviderSettings/ModelList/__tests__/ApiKeyCheckResults.test.tsx`
- 创建：`src/renderer/pages/settings/ProviderSettings/ModelList/__tests__/ModelCheckStatus.test.tsx`
- 修改：`src/renderer/pages/settings/ProviderSettings/ModelList/ModelCheckDialog.tsx`
- 修改：`src/renderer/pages/settings/ProviderSettings/ModelList/ModelListItem.tsx`
- 修改：`src/renderer/pages/settings/ProviderSettings/ModelList/ModelListSections.tsx`
- 修改：`src/renderer/pages/settings/ProviderSettings/ModelList/__tests__/ModelListItem.test.tsx`
- 修改：`src/renderer/pages/settings/ProviderSettings/ModelList/modelListHealthContext.tsx`

- [ ] **步骤 1：写逐 Key 报告失败测试**

对每个真实 Key 断言标签（空时用 `settings.provider.api_key.unnamed`）、脱敏值、Passed/Failed/Disabled、成功 latency、失败完整 error、带 Key 名的 Switch accessible label。明确断言没有 copy/edit/delete 按钮。provider-auth 结果不显示 Key 开关。

```tsx
expect(screen.getByText('Primary')).toBeInTheDocument()
expect(screen.getByText(/sk-.*1234/)).toBeInTheDocument()
expect(screen.getByText('quota exhausted')).toBeInTheDocument()
expect(screen.queryByRole('button', { name: /copy|edit|delete/i })).not.toBeInTheDocument()
```

- [ ] **步骤 2：写五种行状态和 Popover 失败测试**

断言 checking spinner；passed + 最快 latency；partial 显示 `x/y Key 失败`；failed 显示首个错误的一行摘要但 Popover 含完整错误；skipped 可点击查看完整原因。状态 trigger 可聚焦、accessible name 含模型名和结果，Popover 内容通过 Portal 出现在 row 外，模型行仍为 44px 估算合同。

- [ ] **步骤 3：运行三个组件测试确认失败**

```bash
pnpm exec vitest run --project renderer \
  src/renderer/pages/settings/ProviderSettings/ModelList/__tests__/ApiKeyCheckResults.test.tsx \
  src/renderer/pages/settings/ProviderSettings/ModelList/__tests__/ModelCheckStatus.test.tsx \
  src/renderer/pages/settings/ProviderSettings/ModelList/__tests__/ModelListItem.test.tsx
```

预期：FAIL，新组件不存在，模型行不读结果 context。

- [ ] **步骤 4：实现共用 Key 报告**

`ApiKeyCheckResults` 接收 `keyResults`、最新 `apiKeyEntries`、`savingKeyId`、`onToggleKey(keyId, enabled)`。显示状态时优先看最新 entry 的 `isEnabled`；disabled 只改变展示，不覆盖本轮 latency/error。错误正文使用 `healthCheckErrorToDisplayString`，不可在紧凑详情中截断。

- [ ] **步骤 5：实现 Key mutation 和失败回滚**

在 health context 中使用现有 `useProviderMutations(providerId).updateApiKey`。每次只允许一个 Key 保存：

```ts
try {
  setSavingKeyId(keyId)
  await updateApiKey(keyId, { isEnabled: enabled })
} catch (error) {
  logger.error('Failed to update API key from model check result', { providerId, keyId, error })
  toast.error(i18n.t('settings.provider.api_key.save_failed'))
  throw error
} finally {
  setSavingKeyId(null)
}
```

受控 Switch 只从最新 query 状态取值；失败时 query 未变，因此自然回滚。成功 refresh 后报告仍在，下一次 runner 的凭据解析排除停用 Key；重新启用不触发探测。

- [ ] **步骤 6：实现行内状态与 Portal Popover**

`ModelListSections` 通过 `useModelListHealthResults()` 读取 Map，并把 `modelStatusMap.get(model.id)` 传给 memo 化的 `ModelListItem`。模型行把 `ModelCheckStatus` 放在 capability tags 与设置/删除按钮之间。`PopoverTrigger asChild` 包裹语义 Button；`PopoverContent align="end"` 使用固定宽度和最大高度，承载 `ApiKeyCheckResults` 或 skip reason。

- [ ] **步骤 7：复跑逐 Key 和行状态测试**

运行任务 6 步骤 3 的命令。预期：全部 PASS。

- [ ] **步骤 8：提交行内结果**

```bash
git add src/renderer/pages/settings/ProviderSettings/ModelList/ApiKeyCheckResults.tsx \
  src/renderer/pages/settings/ProviderSettings/ModelList/ModelCheckStatus.tsx \
  src/renderer/pages/settings/ProviderSettings/ModelList/ModelCheckDialog.tsx \
  src/renderer/pages/settings/ProviderSettings/ModelList/ModelListItem.tsx \
  src/renderer/pages/settings/ProviderSettings/ModelList/ModelListSections.tsx \
  src/renderer/pages/settings/ProviderSettings/ModelList/modelListHealthContext.tsx \
  src/renderer/pages/settings/ProviderSettings/ModelList/__tests__/ApiKeyCheckResults.test.tsx \
  src/renderer/pages/settings/ProviderSettings/ModelList/__tests__/ModelCheckStatus.test.tsx \
  src/renderer/pages/settings/ProviderSettings/ModelList/__tests__/ModelListItem.test.tsx
git commit -S --signoff -m "feat(model-check): show actionable row results"
```

---

### 任务 7：完成运行协调、mutation 禁用和结果清理

**文件：**
- 修改：`src/renderer/pages/settings/ProviderSettings/ModelList/ProviderModelList.tsx`
- 修改：`src/renderer/pages/settings/ProviderSettings/ModelList/ModelListHeader.tsx`
- 修改：`src/renderer/pages/settings/ProviderSettings/ModelList/ModelListSections.tsx`
- 修改：`src/renderer/pages/settings/ProviderSettings/ModelList/ModelListItem.tsx`
- 修改：`src/renderer/pages/settings/ProviderSettings/ModelList/useProviderModelList.ts`
- 修改：`src/renderer/pages/settings/ProviderSettings/ModelList/useHealthCheck.ts`
- 测试：`src/renderer/pages/settings/ProviderSettings/ModelList/__tests__/ProviderModelList.test.tsx`
- 测试：`src/renderer/pages/settings/ProviderSettings/ModelList/__tests__/ModelListHeader.test.tsx`
- 测试：`src/renderer/pages/settings/ProviderSettings/ModelList/__tests__/ModelListItem.test.tsx`
- 测试：`src/renderer/pages/settings/ProviderSettings/ModelList/__tests__/useHealthCheck.test.tsx`

- [ ] **步骤 1：写交互锁定与可用控件测试**

检测中必须禁用 fetch/add/download/edit/delete/group delete，且不能开启第二次模型检测；搜索、清空搜索、能力筛选、展开/折叠保持可用。测试直接操作对应按钮，不用 props 快照。

```tsx
expect(screen.getByRole('button', { name: /获取模型列表|Get model list/ })).toBeDisabled()
expect(screen.getByRole('button', { name: /设置|Settings/ })).toBeDisabled()
expect(screen.getByRole('button', { name: /搜索|Search/ })).toBeEnabled()
expect(screen.getByRole('button', { name: /筛选|Filter/ })).toBeEnabled()
```

- [ ] **步骤 2：写删除与结果生命周期测试**

成功删除后模型和报告同时消失；删除失败时 optimistic row 回滚且报告仍显示。新增模型不擦除旧结果；同 provider 的搜索/筛选/折叠不改变结果；新 all-model run 清空并替换旧结果。

- [ ] **步骤 3：运行相关测试确认当前 busy 传播不符合规格**

```bash
pnpm exec vitest run --project renderer \
  src/renderer/pages/settings/ProviderSettings/ModelList/__tests__/ProviderModelList.test.tsx \
  src/renderer/pages/settings/ProviderSettings/ModelList/__tests__/ModelListHeader.test.tsx \
  src/renderer/pages/settings/ProviderSettings/ModelList/__tests__/ModelListItem.test.tsx \
  src/renderer/pages/settings/ProviderSettings/ModelList/__tests__/useHealthCheck.test.tsx
```

预期：FAIL，旧 `isBusy` 同时禁用了搜索/筛选/展开，编辑按钮也未使用 disabled。

- [ ] **步骤 4：拆分 mutation busy 与浏览控件状态**

`ProviderModelList` 只把 `disabled` 传给 actions、model mutations 和 group bulk actions；`ModelListHeader` 删除用 busy 禁用搜索/筛选/展开的逻辑。`ModelListItem` 的设置按钮和删除按钮都使用 `disabled`。保持 `DynamicVirtualList.estimateSize` 的 model 分支为 44。

`useHealthCheck` 在 models ID 集合变化时仅修剪已不存在的结果，不因过滤或新增模型重置。删除失败时 `useProviderModelList` 的 optimistic rollback 使同一个 model ID 再现，context 中结果从未被提前删除。

- [ ] **步骤 5：复跑交互与生命周期测试**

运行任务 7 步骤 3 的命令。预期：全部 PASS。

- [ ] **步骤 6：提交协调收尾**

```bash
git add src/renderer/pages/settings/ProviderSettings/ModelList/ProviderModelList.tsx \
  src/renderer/pages/settings/ProviderSettings/ModelList/ModelListHeader.tsx \
  src/renderer/pages/settings/ProviderSettings/ModelList/ModelListSections.tsx \
  src/renderer/pages/settings/ProviderSettings/ModelList/ModelListItem.tsx \
  src/renderer/pages/settings/ProviderSettings/ModelList/useProviderModelList.ts \
  src/renderer/pages/settings/ProviderSettings/ModelList/useHealthCheck.ts \
  src/renderer/pages/settings/ProviderSettings/ModelList/__tests__/ProviderModelList.test.tsx \
  src/renderer/pages/settings/ProviderSettings/ModelList/__tests__/ModelListHeader.test.tsx \
  src/renderer/pages/settings/ProviderSettings/ModelList/__tests__/ModelListItem.test.tsx \
  src/renderer/pages/settings/ProviderSettings/ModelList/__tests__/useHealthCheck.test.tsx
git commit -S --signoff -m "fix(model-check): coordinate model list interactions"
```

---

### 任务 8：补齐中文产品语言、英文基准和变更记录

**文件：**
- 修改：`src/renderer/i18n/locales/zh-cn.json`
- 修改：`src/renderer/i18n/locales/en-us.json`
- 修改：`src/renderer/i18n/translate/*.json`（只由同步命令生成缺失键）
- 创建：`v2-refactor-temp/docs/breaking-changes/2026-08-14-model-check-moved.md`

- [ ] **步骤 1：加入所有用户可见文案**

在 `settings.models.check` 下使用统一词汇：中文 `模型检测`、`单个模型`、`所有模型`、`检测中…`；英文 `Model Check`、`Single model`、`All models`、`Checking…`。补充 Key 范围、预检计数、部分通过、Key 失败计数、完整跳过说明、保存/无可检测模型等键。删除不再引用的 drawer progress/hint 文案，代码中不得出现硬编码用户文案。

- [ ] **步骤 2：同步并检查 i18n**

```bash
pnpm i18n:sync
pnpm i18n:check
```

预期：所有 locale 键集合一致，检查通过；非中英文 locale 对新增键使用同步工具生成的英文基准，不手写机器翻译。

- [ ] **步骤 3：写 breaking-change fragment**

使用本功能规格提交 `3e093073b1fea3ec59b292e0691b78f157785775` 作为稳定的本地提交引用；若执行阶段已经创建 PR，则改写成实际 `#PR`。正文固定表达：模型检测从 API Key 行和侧栏移动到模型列表工具栏；单模型失败留在弹窗，所有模型结果显示在各模型行；用户无需迁移数据或执行手动操作。

```md
---
title: Model checks moved to the model list
category: moved
severity: notice
introduced_in_pr: 3e093073b1fea3ec59b292e0691b78f157785775
date: 2026-08-14
---

## What changed

Single-model and all-model checks now share one Model Check entry in the model-list toolbar. All-model progress and results appear on each model row instead of a side panel.

## Why this matters to the user

The API-key-row check icon and the health-check side panel are gone. Failed models and API keys can now be reviewed where models are edited or removed.

## What the user should do

Nothing — use Model Check from the model-list toolbar.

## Notes for release manager

Covers #17935 and #18434; attach the unified dialog and row-result screenshots.
```

- [ ] **步骤 4：运行文档和硬编码字符串检查**

```bash
pnpm docs:check-links
pnpm exec vitest run --project scripts scripts/__tests__/check-hardcoded-strings.test.ts
```

预期：全部 PASS。

- [ ] **步骤 5：提交语言和变更说明**

```bash
git add src/renderer/i18n/locales/zh-cn.json \
  src/renderer/i18n/locales/en-us.json \
  src/renderer/i18n/translate/de-de.json \
  src/renderer/i18n/translate/el-gr.json \
  src/renderer/i18n/translate/es-es.json \
  src/renderer/i18n/translate/fr-fr.json \
  src/renderer/i18n/translate/ja-jp.json \
  src/renderer/i18n/translate/pt-pt.json \
  src/renderer/i18n/translate/ro-ro.json \
  src/renderer/i18n/translate/ru-ru.json \
  src/renderer/i18n/translate/vi-vn.json \
  src/renderer/i18n/translate/zh-tw.json \
  v2-refactor-temp/docs/breaking-changes/2026-08-14-model-check-moved.md
git commit -S --signoff -m "docs(model-check): document unified model checks"
```

---

### 任务 9：端到端回归与仓库门禁

**文件：**
- 验证：任务 1–8 的全部改动

- [ ] **步骤 1：运行 Provider Settings 定向测试**

```bash
pnpm exec vitest run --project renderer \
  src/renderer/pages/settings/ProviderSettings/__tests__/ProviderSetting.test.tsx \
  src/renderer/pages/settings/ProviderSettings/components/__tests__/AuthenticationSection.test.tsx \
  src/renderer/pages/settings/ProviderSettings/ConnectionSettings/__tests__/ApiKey.test.tsx \
  src/renderer/pages/settings/ProviderSettings/hooks/providerSetting/__tests__/useProviderConnectionCheck.test.tsx \
  src/renderer/pages/settings/ProviderSettings/ModelList/__tests__ \
  src/renderer/pages/settings/ProviderSettings/utils/__tests__/healthCheck.test.ts
```

预期：全部 PASS，无未处理 rejection 和 `act(...)` warning。

- [ ] **步骤 2：用跟踪 Electron 做交互验证**

使用 `cherry-electron-dev` 技能启动隔离用户数据实例，验证：唯一中文入口；单/所有模式表单；不支持模型说明；单模型部分失败留在弹窗；所有模型启动即关闭并逐行更新；错误 Popover；Key 停用后报告保留；检测中 mutation 禁用而搜索/筛选可用。保存至少一张统一 Dialog 和一张行内结果截图作为本地证据。

- [ ] **步骤 3：执行仓库要求的完整命令**

```bash
pnpm lint
pnpm test
pnpm format
pnpm build:check
pnpm test:lint
```

预期：全部退出 0。若全量测试出现与改动无关的资源超时，单独复跑失败文件并在交付中同时报告原始失败与复跑结果；不得把超时当作功能通过证据。

- [ ] **步骤 4：确认提交签名、DCO 和干净工作区**

```bash
git status --short
git log --format='%H %s%n%b' origin/main..HEAD
git cat-file commit HEAD | sed -n '1,18p'
```

预期：工作区为空；每个提交正文包含 `Signed-off-by:`；commit object 包含 `gpgsig`。

- [ ] **步骤 5：仅在验证产生必要修正时提交**

如步骤 1–4 暴露本功能缺陷，先在暴露缺陷的目标测试文件加入最小回归用例，再修改与该用例直接对应的实现文件；使用 `git diff --name-only` 核对只包含本功能文件后，逐个写出这些实际路径执行 `git add`，并运行：

```bash
git commit -S --signoff -m "fix(model-check): address verification findings"
```

若无需修正，不创建空提交。
