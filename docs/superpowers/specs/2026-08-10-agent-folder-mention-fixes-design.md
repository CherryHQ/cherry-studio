# Agent 文件夹提及修复设计

**状态：** 已批准

**目标：** 在不新增共享 API 或 IPC channel 的前提下，让 Agent Composer 的 `@` 资源搜索以有界、可丢弃旧结果的方式返回文件与文件夹，并让已提及文件夹在面板中保持不可重复选择。

## 背景

当前分支为 Agent Composer 增加了文件夹提及，但目录搜索通过 renderer 调用 `listDirectory(..., searchPattern: '.')` 枚举指定深度内的全部目录，再复用 QuickPanel 的过滤与排序逻辑。该实现可以发现空文件夹，却把搜索策略和结果裁剪放到了错误的所有者中：主进程负责文件系统遍历，renderer 却接收无界目录集合并重新实现搜索。

根因是现有 `listDirectory` fuzzy 分支没有履行 `DirectoryListOptions` 的既有契约。它始终运行文件搜索，未正确遵守 `includeFiles` 与 `includeDirectories`。这不是当前功能独有的需求：ArtifactPane 已使用 `includeFiles: true`、`includeDirectories: true` 搜索工作区，但现有 fuzzy 分支实际上不会返回目录。因此修复现有实现具有独立的跨消费者价值。

第二个问题是文件夹建议项固定为 `disabled: false`，而其 command 又拒绝插入已存在的 folder token。Suggestion 在执行 command 前会删除 `@query`；重复选择同一路径因此会吞掉查询文本但不产生 token。

## 范围

### 包含

- 修正主进程 `listDirectory` fuzzy 搜索对 `includeFiles`、`includeDirectories`、`maxDepth`、`includeHidden` 和 `maxEntries` 的执行语义。
- 保留对空文件夹的搜索能力。
- 将 Agent Composer 改为消费主进程返回的有界 `DirectoryEntry[]`，删除 renderer 全量目录索引与重复模糊过滤。
- 对非空 `@` 查询进行 200ms debounce，并忽略已发出请求的旧结果。
- 将当前 editor 中已存在的 folder token 投影为禁用建议项。
- 使用共享的 `DirectoryListOptions` 与 `DirectoryEntry` 类型约束 preload 声明，避免本地重复类型漂移。

### 不包含

- 不新增 `file.search_resources`、新的 `DirectoryListOptions` 字段或新的 IPC channel。
- 不在本功能中迁移整个 legacy file IPC 域到 IpcApi。
- 不在本功能中修复 Tiptap suggestion 的历史 stale-lifecycle 问题。当前工作区对 `suggestionExtension.ts` 及其通用竞态测试的修改应移出本功能提交，作为独立修复评审。
- 不改变 folder token 的序列化格式、prompt text 或消息持久化语义。
- 不扩展搜索深度、隐藏文件策略或可访问路径范围。

## 方案比较

### 方案 A：修复现有主进程契约并简化 renderer（采用）

现有调用面已经表达了所需维度，缺陷位于实现。主进程负责遍历、匹配、排序和统一裁剪；renderer 只负责延迟请求、投影 UI item 与插入 token。

优点：不扩大共享 surface；同时修复 ArtifactPane 等合法消费者；结果在跨进程前已经有界；文件与目录使用一致的搜索语义。

代价：会修改共享文件搜索实现，需要主进程级回归测试，并验证现有文件搜索排序没有退化。

### 方案 B：新增专用资源搜索 IPC（拒绝）

新增 `file.search_resources` 可以直接返回文件和目录，但它与 `listDirectoryEntries` 的所有者、权限、失败模型和数据形状相同，只是为当前 caller 固化一个新名称。它会重复既有契约并增加 schema、handler 与迁移维护成本。

### 方案 C：仅在 renderer debounce 并截断目录索引（拒绝）

给 `searchPattern: '.'` 增加 `maxEntries` 能限制 IPC 数据量，但目录会在匹配查询前被截断。合法匹配可能落在截断范围外，产生无法通过增加测试消除的假阴性；搜索策略仍然分散在 renderer。

## 架构设计

### 主进程目录搜索

`src/main/services/file/tree/search.ts` 继续作为唯一文件系统搜索实现，不改变公开函数签名。

搜索模式分为两类：

1. `searchPattern === '.'`：保持现有 list mode 行为。
2. 非空真实查询且 fuzzy 开启：分别按 include flags 收集文件候选和目录候选，然后合并评分与裁剪。

文件候选继续通过 ripgrep 获得。只有 `includeFiles` 为 `true` 时才解析并执行 ripgrep；目录专用调用不应因 ripgrep 不可用而失败。

目录候选通过受 `recursive`、`maxDepth`、`includeHidden` 和既有 excluded-directory 规则约束的文件系统遍历获得。遍历直接观察目录项，因此空文件夹与不含可索引文件的文件夹仍然可搜索。候选路径使用现有 fuzzy 匹配与评分规则，避免 main 与 renderer 形成两套排序语义。

文件与目录候选合并后按以下稳定顺序排序：

1. fuzzy score 降序；
2. 分数相同则目录优先；
3. 仍相同则按规范化路径 `localeCompare`。

`maxEntries` 在合并排序后统一应用，保证公开契约中的上限也是 IPC 返回上限。`includeFiles: false` 时结果中不得出现文件；`includeDirectories: false` 时结果中不得出现目录。

主进程沿用现有失败语义：根路径不可访问或需要的 ripgrep 文件搜索失败时，请求拒绝；递归访问某个子目录失败时记录日志并继续返回可访问结果。

### Renderer 资源查询

`useAgentResourceMentionSource` 不再导入 QuickPanel 的默认过滤或排序实现，也不保留目录列表 cache。所有 workspace 资源都来自 `window.api.file.listDirectoryEntries`。

空查询立即发起非递归请求，参数为：

- `recursive: false`
- `includeHidden: false`
- `includeFiles: true`
- `includeDirectories: true`
- `maxEntries: 40`
- `searchPattern: '.'`

真实查询在 200ms debounce 后发起，参数为：

- `recursive: true`
- `maxDepth: 3`
- `includeHidden: false`
- `includeFiles: true`
- `includeDirectories: true`
- `maxEntries: 40`
- `searchPattern: normalizedQuery`

40 条上限保持当前实现最多约 40 条的总体结果规模，同时把限制移动到跨进程边界之前。多个 accessible roots 各自受该上限约束；renderer 使用规范化绝对路径去重。

每次调度递增 request generation。新查询、空查询、accessible-path scope 变化、panel exit 和组件卸载都会使旧 generation 失效。尚未触发的 timer 被清除并立即解析为空结果；已经发出的 IPC 无法中止，但完成后若 generation 过期则丢弃结果。

多个 root 使用 `Promise.allSettled`：

- 至少一个 root 成功时展示成功结果，不为部分失败添加干扰性错误行。
- 全部 root 失败且没有资源结果时复用现有本地化错误项。
- 合法的空搜索结果保持空列表，不伪装为 I/O 错误。

### 建议项与 token

renderer 将 `DirectoryEntry` 按 `isDirectory` 投影：

- 文件继续转换为 managed file token，并同步 `files` 状态。
- 文件夹继续使用 `createComposerFolderToken`，不进入 `files` 状态。

在生成目录建议项前，仅序列化 editor 一次并建立 `Set`：集合键为现有 `kind === 'folder'` token 的 `promptText`。目录路径存在于集合时设置 `disabled: true`。command 保留重复检查，以覆盖面板生成后 editor 状态发生变化的竞态；正常 QuickPanel 行为会在 command 前阻止禁用项被执行。

## 文件职责

- `src/main/services/file/tree/search.ts`：履行文件与目录 fuzzy 搜索、排序和上限契约。
- `src/main/services/file/tree/__tests__/search.test.ts`：锁定 shared search 的 include flags、空目录、排序和上限语义。
- `src/preload/preload.ts`：复用共享目录类型；不改变运行时桥接方法。
- `src/renderer/components/composer/variants/agent/useAgentResourceMentionSource.tsx`：debounce、generation、跨 root 聚合、建议项投影和 folder disabled 状态。
- `src/renderer/components/composer/variants/__tests__/AgentComposer.test.tsx`：覆盖 Agent Composer 的查询参数、竞态和 token 行为。
- `src/renderer/components/composer/quickPanel/suggestionExtension.ts` 与 `src/renderer/components/composer/__tests__/suggestionExtension.test.ts`：不属于本设计，当前相关工作区修改应拆出。

## 测试设计

### 主进程契约测试

新增或扩展 `search.test.ts`，使用真实临时目录和测试 ripgrep：

1. `includeFiles: false, includeDirectories: true` 的 fuzzy 查询只返回匹配目录，并能返回空文件夹。
2. `includeFiles: true, includeDirectories: false` 保持现有文件 fuzzy 结果，不返回目录。
3. 两个 include flags 都为 `true` 时返回匹配文件和目录。
4. fuzzy 缩写查询按字符顺序匹配目录名。
5. 合并候选在应用 `maxEntries` 后不超过上限，精确/前缀匹配排在弱匹配前。
6. `recursive`、`maxDepth` 和 hidden/excluded-directory 规则继续约束目录候选。
7. ripgrep 不可用时，目录专用搜索仍可执行；包含文件搜索的请求保持现有错误。

### Renderer 行为测试

更新 `AgentComposer.test.tsx`：

1. 空查询只调用一次组合的非递归 `listDirectoryEntries`，并展示根级文件与文件夹。
2. 连续输入只启动最后一个 200ms 后的真实查询。
3. 非空查询发送组合 include flags、`maxDepth: 3`、`maxEntries: 40` 和最新 search pattern。
4. stale generation 的返回值不会替换最新结果。
5. 文件夹结果插入 folder token，且不修改 `files`。
6. editor 已包含相同 folder token 时，对应建议项为 disabled；其 command 防线也不重复插入。
7. accessible paths 变化后，旧结果被忽略，新查询只使用新 scope。
8. 部分 root 失败保留成功资源；全部失败显示现有错误项。

测试断言聚焦可观察行为和调用契约，不复制主进程 fuzzy 算法到 renderer 测试。

## 验证与提交边界

实现阶段按 TDD 顺序先增加失败测试，再做最小实现。先运行主进程搜索目标测试和 Agent Composer 目标测试；完成后按仓库要求运行：

- `pnpm lint`
- `pnpm test`
- `pnpm format`
- `pnpm build:check`
- `pnpm test:lint`

功能修复与历史 Tiptap suggestion 竞态修复应保持独立提交。当前功能提交只包含上述主进程契约修复、renderer 简化、重复文件夹禁用及其测试。

## 风险与缓解

- **共享搜索排序变化：** combined fuzzy 搜索会首次让目录参与默认 include-both 查询。通过 main service 排序/上限测试和 ArtifactPane 现有消费者检查控制风险。
- **大型目录遍历：**发现空目录需要遍历目录树，无法由 ripgrep 文件列表替代。debounce、`maxDepth: 3`、hidden/excluded 规则以及 IPC 前裁剪限制浪费和传输规模。
- **跨 root 结果规模：**上限按 root 应用，与现有调用模式一致；renderer 去重后再投影，不新增全局索引。
- **旧请求无法真正取消：**IPC 完成后用 generation 丢弃，不向通用 suggestion 生命周期增加新的共享状态或补丁。
