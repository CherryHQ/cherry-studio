# Add Source Dialog: 确认提交与 Sitemap 语义收敛

共享约束见 [plans/README.md](./README.md)。

## 目标

- 将当前 `website` 入口明确收敛为 `sitemap`，消除 UI 和数据类型中的歧义。
- 为 `AddKnowledgeItemDialog` 接入真实提交流程，但只在用户点击确认后才落库和触发嵌入。
- 复用现有 `DataApi + IPC` 边界，不新增主进程新接口。

## 范围

- 接入 `file`、`directory`、`url`、`sitemap` 四种 source 的真实提交流程。
- `file` 在确认时上传文件并创建知识项。
- `directory` 在确认时只创建目录 owner item，由主进程 runtime 负责展开。
- `url` 在确认时创建单个 `url` item。
- `sitemap` 在确认时创建单个 `sitemap` owner item，由主进程 runtime 展开为 `url` 子项。

## 非目标

- 本次不接 `note` 的真实数据源，继续保留占位态。
- 本次不新增新的 main-process handler、service API 或 IPC channel。
- 本次不实现“网站爬虫设置”类伪配置，例如深度、最大页面数。
- 本次不做 renderer 侧失败回滚。

## 具体任务

1. 先做语义收敛。
   - 将 `KnowledgeDataSourceType` 中的 `website` 改为 `sitemap`。
   - 将 `WebsiteSourceContent.tsx` 重命名为 `SitemapSourceContent.tsx`。
   - 更新 dialog tabs、常量、测试、i18n key 与文案，全部统一为 `sitemap`。
   - 移除当前 `website` 面板中没有真实后端语义的深度和页面数输入。

2. 补齐 dialog 本地草稿状态。
   - `file`：保存浏览器 `File[]`。
   - `directory`：同时保存原始目录文件 `File[]` 和用于展示的目录聚合结果。
   - `url`：保存受控输入值。
   - `sitemap`：保存受控输入值。
   - `note`：继续保持不可提交。

3. 建立 renderer 侧组合提交 hook。
   - 在 `knowledge.v2/hooks/` 中新增 V2 专用提交 hook。
   - 职责固定为：组装 DTO、调用 `POST /knowledge-bases/:id/items`、拿到返回的 item ids、调用 `IpcChannel.KnowledgeRuntime_AddItems`、刷新 `'/knowledge-bases/:id/items'`。
   - 不把文件上传、DTO 映射、IPC 调用散落在组件内。

4. 接入确认提交流程。
   - `AddKnowledgeItemDialog` 从 `useKnowledgePage()` 读取当前 `selectedBaseId`。
   - 点击确认时才执行真实逻辑，拖拽和输入阶段只更新本地状态。
   - 提交成功后关闭 dialog 并重置状态。
   - 提交中禁用重复点击和关闭动作。

5. 定义各 source 的 DTO 映射。
   - `file`：
     - 使用 `window.api.file.getPathForFile(file)` 获取本地真实路径。
     - 使用 `window.api.file.get(path)` 转成外部 `FileMetadata`。
     - 使用 `FileManager.uploadFiles()` 在确认时上传到文件存储。
     - 将上传结果映射为 `type: 'file'` 的知识项创建 DTO。
   - `directory`：
     - 从 `webkitRelativePath` 提取顶层目录。
     - 每个顶层目录只创建一个 `type: 'directory'` owner item。
     - `data.path` 使用该目录的绝对路径。
     - 不在 renderer 展开目录树。
   - `url`：
     - 创建单个 `type: 'url'` item。
     - `data.name` 默认使用输入的 URL。
   - `sitemap`：
     - 创建单个 `type: 'sitemap'` owner item。
     - `data.name` 默认使用输入的 URL。

6. 统一错误与反馈策略。
   - DataApi 失败：不触发 IPC，保留当前输入，toast error。
   - IPC 失败：保留已创建的 DB items，不做前端回滚，toast error。
   - 成功：toast success，关闭 dialog，刷新当前 knowledge items 列表。

## 约束

- 真实写库只通过 `POST /knowledge-bases/:id/items` 完成。
- 真实嵌入只通过 `IpcChannel.KnowledgeRuntime_AddItems` 触发。
- `directory` 和 `sitemap` 的展开逻辑必须继续放在 `KnowledgeOrchestrationService`，不能下沉到 renderer 做兼容处理。
- `note` tab 在本次内必须保持明确的“未接入”状态，不能出现看似可用但不会提交的伪交互。

## 验收标志

- dialog 中不再出现 `website`，统一显示为 `sitemap`。
- `file`、`directory`、`url`、`sitemap` 在点击确认前都不会写库或触发 IPC。
- 点击确认后能够按 source 正确创建 knowledge items，并触发 runtime 嵌入。
- `directory` 和 `sitemap` 均以 owner item 入库，并由主进程完成展开。
- `note` 仍然保持占位且确认按钮不可用。
- 组件测试和提交 hook 测试覆盖上述关键路径。
