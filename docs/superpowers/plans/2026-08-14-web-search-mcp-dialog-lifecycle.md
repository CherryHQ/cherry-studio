# Web Search 与 MCP 弹窗生命周期修复实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 让 Web Search API Key 管理 Dialog 随设置页面卸载，避免魔搭 MCP 深链导航后旧 Dialog 与 MCP 安装 Dialog 并存并阻断交互。

**架构：** 保留现有 Key 列表内容和持久化逻辑，仅将其外层从全局 `createPopup` 条目改为由 `WebSearchProviderSetting` 持有 `open` 状态的受控 Dialog。回归测试使用真实 UI Dialog 和 `PopupHost` 模拟修复前的跨路由残留，并通过切换到真实 `McpProtocolInstallDialog` 验证页面只剩一个可交互模态框。

**技术栈：** React 19、TypeScript、Radix/Shadcn Dialog（`@cherrystudio/ui`）、Vitest、Testing Library、Electron CDP。

---

## 任务 1：用真实 Dialog 锁定跨路由残留回归

**文件：**

- 新建：`src/renderer/pages/settings/WebSearchSettings/__tests__/WebSearchMcpDialogLifecycle.test.tsx`
- 修改：`src/renderer/pages/settings/WebSearchSettings/__tests__/WebSearchProviderSetting.test.tsx`
- 参考：`src/renderer/pages/settings/McpSettings/__tests__/McpProtocolInstallDialog.test.tsx`
- 参考：`src/renderer/components/PopupHost/PopupHost.tsx`

- [x] 编写最小集成测试，固定翻译输出并使用真实 `@cherrystudio/ui`，只 mock 路由、IPC、主题和业务数据 hook 等外部边界。
- [x] 在同一渲染根中同时保留 `PopupHost`：先渲染 `WebSearchProviderSetting` 并点击 Key 列表按钮，再 rerender 为 `McpProtocolInstallDialog`，模拟深链导致设置路由卸载。
- [x] 断言用户可见结果：Tavily Dialog 打开；路由切换后 Tavily Dialog 消失；只剩 MCP Dialog；点击“取消”调用 MCP 的 `onClose`。
- [x] 增加保存失败用例：修改行内 Key、让持久化拒绝，点击列表按钮后真实 Dialog 不出现且现有错误提示保留。
- [x] 将旧父组件测试中对 `WebSearchApiKeyListPopup.show` 的内部 mock 断言收敛为外部持久化断言，避免测试已删除的命令式实现。

预期测试核心：

```tsx
const view = render(
  <>
    <WebSearchProviderSetting {...props} />
    <PopupHost />
  </>
)

await user.click(screen.getByRole('button', { name: 'settings.provider.api.key.list.open' }))
expect(await screen.findByRole('dialog', { name: keyListTitle })).toBeInTheDocument()

view.rerender(
  <>
    <McpProtocolInstallDialog servers={servers} onClose={onClose} onInstall={onInstall} />
    <PopupHost />
  </>
)

expect(screen.queryByRole('dialog', { name: keyListTitle })).not.toBeInTheDocument()
expect(screen.getAllByRole('dialog')).toHaveLength(1)
await user.click(screen.getByRole('button', { name: 'common.cancel' }))
expect(onClose).toHaveBeenCalledOnce()
```

- [x] 运行新测试并确认它因旧 Tavily popup 在 rerender 后仍存在而失败，而不是因测试装配错误失败：

```bash
pnpm exec vitest run --project renderer src/renderer/pages/settings/WebSearchSettings/__tests__/WebSearchMcpDialogLifecycle.test.tsx
```

## 任务 2：将 Key 列表改为页面本地受控 Dialog

**文件：**

- 修改：`src/renderer/pages/settings/WebSearchSettings/components/WebSearchApiKeyList.tsx`
- 修改：`src/renderer/pages/settings/WebSearchSettings/components/WebSearchProviderSetting.tsx`

- [x] 在 `WebSearchApiKeyList.tsx` 删除 `createPopup` 和 `PopupInjectedProps` 依赖，保留列表内删除确认继续使用 `popup.confirm`。
- [x] 导出窄接口的受控组件：

```tsx
interface WebSearchApiKeyListDialogProps {
  providerId: WebSearchProviderId
  title?: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

export const WebSearchApiKeyListDialog: FC<WebSearchApiKeyListDialogProps> = ({
  providerId,
  title,
  open,
  onOpenChange
}) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    {/* 保留现有 DialogContent、标题与 WebSearchApiKeyList */}
  </Dialog>
)
```

- [x] 在 `WebSearchProviderSetting` 新增 `apiKeyListOpen` 状态；保存成功后设置为 `true`，保存失败保持 `false`。
- [x] 将 `WebSearchApiKeyListDialog` 渲染在 `SettingGroup` 的本地组件树中（内容仍通过 Dialog Portal 呈现），并用 `setApiKeyListOpen` 处理关闭；不修改 MCP、共享 Dialog 或全局 popup 基础设施。
- [x] 运行回归测试并确认转绿：

```bash
pnpm exec vitest run --project renderer \
  src/renderer/pages/settings/WebSearchSettings/__tests__/WebSearchMcpDialogLifecycle.test.tsx \
  src/renderer/pages/settings/WebSearchSettings/__tests__/WebSearchProviderSetting.test.tsx \
  src/renderer/pages/settings/WebSearchSettings/__tests__/WebSearchApiKeyList.test.tsx \
  src/renderer/pages/settings/McpSettings/__tests__/McpProtocolInstallDialog.test.tsx
```

## 任务 3：真实实例回归与完整验证

**文件：**

- 验证：`.context/cherry-electron-dev/instance.json`
- 验证：`.context/cherry-electron-dev/electron.log`
- 修改：仅当格式化器对本计划涉及文件产生必要变更时接受对应 diff

- [x] 使用现有隔离 Electron 实例：打开 Web Search/Tavily Key 列表，再注入与 ModelScope 等价的 MCP 安装深链。
- [x] 验证 Tavily Dialog 随导航消失、MCP 页面只有一个 Dialog，鼠标“取消”和 Escape 可用；检查无 renderer page error。
- [x] 运行针对性 main 协议测试与 UI Dialog 测试，确认未破坏既有协议和 Dialog 契约。
- [x] 按仓库要求运行完整验证，并检查格式化没有带入无关文件：

```bash
pnpm lint
pnpm test
pnpm format
pnpm build:check
git status --short
git diff --check
```

- [x] 提交前自检：设计规格的 7 条验收标准均有测试或真实实例证据；没有占位符；没有扩展共享基础设施；类型、i18n 和格式检查通过。
- [x] 使用聚焦 Conventional Commit、GPG/SSH 签名和 DCO sign-off 提交，并验证提交对象包含 `gpgsig`：

```bash
git add docs/superpowers/plans/2026-08-14-web-search-mcp-dialog-lifecycle.md \
  src/renderer/pages/settings/WebSearchSettings/components/WebSearchApiKeyList.tsx \
  src/renderer/pages/settings/WebSearchSettings/components/WebSearchProviderSetting.tsx \
  src/renderer/pages/settings/WebSearchSettings/__tests__/WebSearchProviderSetting.test.tsx \
  src/renderer/pages/settings/WebSearchSettings/__tests__/WebSearchMcpDialogLifecycle.test.tsx
git commit -S --signoff -m "fix(web-search): scope API key dialog to settings page"
git cat-file commit HEAD | rg '^gpgsig '
git show -s --format='%B' HEAD | rg '^Signed-off-by:'
```
