# 模型内置搜索偏好实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 让 Web Search 开关、Preference 布尔值和运行时路由统一为 `true = 优先模型内置搜索`，并在升级时保留既有用户的实际策略。

**架构：** 用新的 `chat.web_search.model_tools_preferred` Preference 取代语义相反的旧键，默认值为 `true`。设置页和 Web Search 按钮直接消费新值；共享路由器以该值选择 model-native（当前内部 route 名为 `server`）或 configured-service（当前内部 route 名为 `client`）一侧；一次性 Seeder 将旧值取反迁移到新键。

**技术栈：** TypeScript、React、i18next、Drizzle/better-sqlite3、Vitest、Testing Library、Preference data-classify generator。

---

## 文件结构

- 修改 `v2-refactor-temp/tools/data-classify/data/target-key-definitions.json`：定义新 Preference 键和默认值。
- 生成 `src/shared/data/preference/preferenceSchemas.ts`：提供新键类型与默认值。
- 修改 `src/main/data/db/seeding/seeders/webSearchPreferenceUpgradeSeeder.ts`：以新 hash 版本原子迁移旧键并删除旧行。
- 创建 `src/main/data/db/seeding/seeders/__tests__/modelToolsPreferenceUpgradeSeeder.test.ts`：保护新装默认值、双向旧值转换和幂等行为。
- 修改 `src/main/data/db/seeding/seeders/__tests__/preferenceSeeder.test.ts`：验证生成默认值。
- 修改 `src/shared/utils/provider.ts`、`src/shared/utils/__tests__/provider.serverTools.test.ts`：统一共享路由参数语义。
- 修改 `src/main/ai/runtime/aiSdk/params/buildAgentParams.ts`、`src/main/ai/runtime/aiSdk/params/__tests__/buildAgentParams.test.ts`：主进程读取新键并验证实际工具注入。
- 修改 `src/renderer/hooks/useWebSearch.ts`、`src/renderer/components/composer/tools/components/WebSearchButton.tsx` 及其测试：Renderer 直接传递新语义。
- 修改 `src/renderer/pages/settings/WebSearchSettings/components/ToolSourceSettings.tsx`、`src/renderer/pages/settings/WebSearchSettings/__tests__/WebSearchSettings.test.tsx`：保留当前 tooltip 布局并让开关直写新值。
- 修改 `src/renderer/i18n/locales/*.json`：替换 12 个 locale 的标题和 tooltip 键值。

### 任务 1：Preference 合同与既有用户迁移

**文件：**
- 修改：`src/main/data/db/seeding/seeders/webSearchPreferenceUpgradeSeeder.ts`
- 创建：`src/main/data/db/seeding/seeders/__tests__/modelToolsPreferenceUpgradeSeeder.test.ts`
- 修改：`src/main/data/db/seeding/seeders/__tests__/preferenceSeeder.test.ts`
- 修改：`v2-refactor-temp/tools/data-classify/data/target-key-definitions.json`
- 生成：`src/shared/data/preference/preferenceSchemas.ts`

- [ ] **步骤 1：编写失败的迁移和默认值测试**

测试应直接断言以下合同：

```ts
expect(await readPreference(MODEL_TOOLS_PREFERRED_KEY)).toBe(true)
expect(await readPreference(CLIENT_TOOLS_PREFERRED_KEY)).toBeUndefined()

await writeLegacyPreference(false)
new SeedRunner(dbh.db).runAll(WEB_SEARCH_PREFERENCE_SEEDERS)
expect(await readPreference(MODEL_TOOLS_PREFERRED_KEY)).toBe(true)

await writeLegacyPreference(true)
new SeedRunner(dbh.db).runAll(WEB_SEARCH_PREFERENCE_SEEDERS)
expect(await readPreference(MODEL_TOOLS_PREFERRED_KEY)).toBe(false)
```

另一个测试在首次迁移后手动写入新值，再次运行同一 `SeedRunner`，断言用户新选择没有被覆盖。

- [ ] **步骤 2：运行测试确认红灯**

运行：

```bash
pnpm test:main src/main/data/db/seeding/seeders/__tests__/modelToolsPreferenceUpgradeSeeder.test.ts src/main/data/db/seeding/seeders/__tests__/preferenceSeeder.test.ts
```

预期：新 Seeder/新 Preference 键尚不存在，测试失败。

- [ ] **步骤 3：实现最小 Preference 合同和迁移**

将生成器定义改为：

```json
{
  "targetKey": "chat.web_search.model_tools_preferred",
  "type": "boolean",
  "defaultValue": true,
  "status": "classified",
  "description": "Prefer model-native web search and URL fetching"
}
```

运行生成器：

```bash
cd v2-refactor-temp/tools/data-classify
npm run generate
```

现有 `WebSearchPreferenceUpgradeSeeder` 改为在一个同步 transaction 中读取旧行；存在时写入 `!legacy.value` 到新键并删除旧键。迁移常量变化会更新 hash 版本，使已执行过旧版 Seeder 的数据库重新运行；跨版本直升则直接按原始语义迁移，不经过中间改写。

- [ ] **步骤 4：运行聚焦 Main 测试确认绿灯**

运行任务 1 步骤 2 的同一命令，预期相关测试全部通过且无警告。

### 任务 2：共享路由和主进程采用正向语义

**文件：**
- 修改：`src/shared/utils/provider.ts`
- 修改：`src/shared/utils/__tests__/provider.serverTools.test.ts`
- 修改：`src/main/ai/runtime/aiSdk/params/buildAgentParams.ts`
- 修改：`src/main/ai/runtime/aiSdk/params/__tests__/buildAgentParams.test.ts`

- [ ] **步骤 1：先把路由合同测试改成新语义**

核心断言为：

```ts
expect(resolveWebToolRoutes(claude, serverProvider, { ...bothEnabled, modelToolsPreferred: true })).toEqual({
  webSearch: 'server',
  webFetch: 'server'
})
expect(resolveWebToolRoutes(claude, serverProvider, { ...bothEnabled, modelToolsPreferred: false })).toEqual({
  webSearch: 'client',
  webFetch: 'client'
})
```

同步调整主进程测试，让 Preference `true` 期望注入 provider/model-native 插件，`false` 期望注入配置服务工具。

- [ ] **步骤 2：运行 Shared 与 Main 测试确认红灯**

运行：

```bash
pnpm test:shared src/shared/utils/__tests__/provider.serverTools.test.ts
pnpm test:main src/main/ai/runtime/aiSdk/params/__tests__/buildAgentParams.test.ts
```

预期：生产代码仍接受 `clientToolsPreferred`，类型或行为断言失败。

- [ ] **步骤 3：实现最小路由改名与分支反转**

把 `resolveWebToolRoutes` 选项改为 `modelToolsPreferred`，并使用：

```ts
const selectedSide = options.modelToolsPreferred
  ? serverAvailable
    ? 'server'
    : clientAvailable
      ? 'client'
      : undefined
  : clientAvailable
    ? 'client'
    : serverAvailable
      ? 'server'
      : undefined
```

主进程只读取 `chat.web_search.model_tools_preferred` 并按同名变量传入共享路由器。

- [ ] **步骤 4：重跑任务 2 的两个聚焦测试确认绿灯**

预期：共享和主进程目标文件均通过。

### 任务 3：设置页、Composer 预测与 i18n 文案

**文件：**
- 修改：`src/renderer/hooks/useWebSearch.ts`
- 修改：`src/renderer/components/composer/tools/components/WebSearchButton.tsx`
- 修改：`src/renderer/components/composer/tools/components/__tests__/WebSearchButton.test.tsx`
- 修改：`src/renderer/pages/settings/WebSearchSettings/components/ToolSourceSettings.tsx`
- 修改：`src/renderer/pages/settings/WebSearchSettings/__tests__/WebSearchSettings.test.tsx`
- 修改：`src/renderer/i18n/locales/de-de.json`
- 修改：`src/renderer/i18n/locales/el-gr.json`
- 修改：`src/renderer/i18n/locales/en-us.json`
- 修改：`src/renderer/i18n/locales/es-es.json`
- 修改：`src/renderer/i18n/locales/fr-fr.json`
- 修改：`src/renderer/i18n/locales/ja-jp.json`
- 修改：`src/renderer/i18n/locales/pt-pt.json`
- 修改：`src/renderer/i18n/locales/ro-ro.json`
- 修改：`src/renderer/i18n/locales/ru-ru.json`
- 修改：`src/renderer/i18n/locales/vi-vn.json`
- 修改：`src/renderer/i18n/locales/zh-cn.json`
- 修改：`src/renderer/i18n/locales/zh-tw.json`

- [ ] **步骤 1：先改 Renderer 行为测试**

设置页测试应查找新 accessible name 并验证直写：

```ts
const prioritySwitch = screen.getByRole('switch', {
  name: 'settings.tool.websearch.model_tools_preferred.label'
})
expect(prioritySwitch).toHaveAttribute('aria-checked', 'true')
fireEvent.click(prioritySwitch)
await waitFor(() => {
  expect(MockUsePreferenceUtils.getPreferenceValue('chat.web_search.model_tools_preferred')).toBe(false)
})
```

Composer 测试的 Preference fixture 改用新键，并继续断言预测路由与主进程一致。

- [ ] **步骤 2：运行 Renderer 测试确认红灯**

运行：

```bash
pnpm test:renderer src/renderer/pages/settings/WebSearchSettings/__tests__/WebSearchSettings.test.tsx src/renderer/components/composer/tools/components/__tests__/WebSearchButton.test.tsx
```

预期：新键和 `modelToolsPreferred` 生产接口尚未接入，测试失败。

- [ ] **步骤 3：实现 Renderer 和全部 locale 文案**

`useWebSearchSettings` 暴露 `modelToolsPreferred` / `setModelToolsPreferred`；`ToolSourceSettings` 直接绑定这两个成员，并保留当前 `InfoTooltip` 布局。简体中文资源精确使用：

```json
"settings.tool.websearch.model_tools_preferred.description": "模型内置搜索服务不可用时自动切换到上方服务",
"settings.tool.websearch.model_tools_preferred.label": "优先使用模型内置搜索"
```

其他 11 个 locale 使用等义翻译。`WebSearchButton` 读取新 Preference 并将值以 `modelToolsPreferred` 传给共享路由器。

- [ ] **步骤 4：重跑 Renderer 测试和 i18n 检查确认绿灯**

运行：

```bash
pnpm test:renderer src/renderer/pages/settings/WebSearchSettings/__tests__/WebSearchSettings.test.tsx src/renderer/components/composer/tools/components/__tests__/WebSearchButton.test.tsx
pnpm i18n:check
```

预期：目标 Renderer 测试和 i18n 检查通过。

### 任务 4：聚焦回归验证与提交记录撤回

**文件：**
- 检查：本计划列出的全部文件
- 保留：用户原有 `ToolSourceSettings.tsx` tooltip 布局修改

- [ ] **步骤 1：运行全部聚焦测试（不跑全量套件）**

```bash
pnpm test:shared src/shared/utils/__tests__/provider.serverTools.test.ts
pnpm test:main src/main/data/db/seeding/seeders/__tests__/modelToolsPreferenceUpgradeSeeder.test.ts src/main/data/db/seeding/seeders/__tests__/preferenceSeeder.test.ts src/main/ai/runtime/aiSdk/params/__tests__/buildAgentParams.test.ts
pnpm test:renderer src/renderer/pages/settings/WebSearchSettings/__tests__/WebSearchSettings.test.tsx src/renderer/components/composer/tools/components/__tests__/WebSearchButton.test.tsx
pnpm i18n:check
```

- [ ] **步骤 2：运行变更范围静态检查**

运行 `pnpm lint` 会触发全仓 typecheck/格式化，因此遵守用户“不跑全量测试”的同时仍可运行；但它会写文件。先使用 `git diff --check`、针对改动文件的 Biome/ESLint，以及 `pnpm typecheck`。若仓库工具要求 `pnpm lint` 才能证明合同，则运行它并复核没有改写无关文件。

- [ ] **步骤 3：使用同一 Electron 实例验证设置页**

打开 Web Search 设置，确认底部标题、tooltip、默认开启状态和切换持久化；保持实例运行并记录 PID/CDP 信息。

- [ ] **步骤 4：撤回规格提交记录并保留工作区内容**

确认 `a01172a44a` 仍是当前唯一新增提交后执行：

```bash
git reset --mixed aee23d6ba9d555e33d5aa696682b503f7afbb136
```

再用 `git log -2 --oneline` 确认 `a01172a44a` 不在当前分支历史中，并用 `git status --short` 确认规格、计划与实现内容仍保留在工作区。
