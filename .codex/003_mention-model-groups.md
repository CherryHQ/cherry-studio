# 输入框「@模型分组」功能开发

## 背景
- 概要：在输入框使用 `@` 选择模型时，支持用户按“分组”一次性选择多个模型，避免逐个点选。
- 相关上下文：现有 `@` 选择面板由 `QuickPanel` 实现，模型列表由 `MentionModelsButton.tsx` 生成；已存在“置顶模型”与多选逻辑。
- 假设与依赖：
  - 分组持久化存储使用 Dexie `settings` 表（键：`mention:modelGroups`）。
  - 分组成员以 `getModelUniqId(model)` 标识，运行时通过 provider 列表映射回模型对象。
  - 仍沿用现有限制：包含图片文件时仅允许视觉模型；整组切换逐项调用 `onMentionModel`，继承限制判断。

## 目标 / 验收标准
- [x] 在 `@` 面板顶部展示“模型分组”列表（名称+数量），可点击一键切换整组选中状态。
- [x] 提供“Save selection as group...”操作，将当前已选模型保存为分组（同名覆盖）。
- [x] 分组右侧提供删除按钮，可从面板直接删除该分组。
- [x] 分组数据持久化到 `db.settings['mention:modelGroups']`，重启后仍可用。
- [x] 修复“Save selection as group...”禁用态不会随选择变化更新的问题：面板开启期间始终可点击；未选择模型时点击给出提示，不执行保存。
- [x] 分组增强：支持置顶/取消置顶（置顶优先显示，其余按名称升序）、重命名、删除确认弹窗。
- [x] i18n：新增“模型分组”相关文案键值（en-us、zh-cn），面板内新增提示/标题使用翻译。

## 约束
- 本地沙箱环境：网络受限、文件系统写入部分受限，无法在此直接 `yarn install / yarn dev` 运行验证；需由本地环境执行验证步骤。

## 计划
- [x] 设计并实现分组持久化（Dexie settings，键名与结构约定）。
- [x] 在 `MentionModelsButton` 构建列表时插入“分组”条目，并显示选中状态。
- [x] 实现整组切换逻辑（全选→整组移除；非全选→补齐缺失项）。
- [x] 新增“保存当前选择为分组”入口，弹出命名输入并保存（支持同名覆盖）。
- [x] 为分组项添加删除按钮（后缀图标）。
- [x] 引入错误处理与输入校验（数据库读写 try/catch、名称校验、ID 生成统一）。
- [x] 移除直接 DOM 查询（使用触发位置信息与 ref，避免 `document.querySelector`）。
- [x] 处理并发与竞态（模态弹窗互斥、防闭包旧值、卸载清理）。
- [x] 基础单元测试（工具函数 `groupHelpers`、`textHelpers`）。
- [ ] 本地运行与交互测试（需在可联网且可写环境执行）。

## 执行日志
- 2025-09-06：完成分组数据结构与 Dexie settings 持久化读写。
- 2025-09-06：在面板中渲染分组，支持显示模型数量与选中态；新增整组切换函数。
- 2025-09-06：新增“Save selection as group...”，支持同名覆盖；为分组添加删除按钮。
- 2025-09-06：受限于沙箱，未能本地运行 yarn；请在本地执行 `yarn install && yarn dev` 验证。
- 2025-09-07：移除“Save selection as group...”条目的静态 `disabled`，避免 QuickPanel 列表项禁用态“陈旧”；在保存动作内增加空选择校验并弹出提示。
- 2025-09-07：完成增强——分组置顶/排序、重命名与删除确认；补充 i18n（`mention_group.*`）。
 - 2025-09-07：修复同一轮面板中保存分组无法识别最新选择的问题（闭包捕获旧 `mentionedModels`）；改为通过 `useRef` 读取实时选择与分组快照。
 - 2025-09-07：Bugfix - 分组置顶按钮看似无效：最初尝试通过 QuickPanel `updateList` 实时刷新；按最新指示已移除“分组置顶”功能与相关刷新逻辑，避免与“模型置顶”混淆并修复构建异常。

### 评审反馈处理（2025-09-10）
- 性能与依赖：列表项选中判断改为使用 `mentionedSet.has()`，减少 `buildModelItems` 依赖；保留后续拆分与虚拟化作为优化项。
- 直接 DOM 查询：删除对 `.inputbar textarea` 的查询；改为使用 `triggerInfo.position` 与内部 caret 计算，确保与 React 模式一致。
- 错误处理：
  - `useLiveQuery`（分组、置顶模型）与 `saveGroups` 增加 try/catch 与日志；对用户显示错误提示。
  - 删除/重命名/保存操作均在保存失败时友好提示。
- 并发与竞态：
  - 新增 `modalOpenRef` 防重复弹窗；关闭时复位，避免 `tempName` 闭包陈旧值问题。
  - 组件卸载时清理 `triggerInfoRef`、`hasModelActionRef`、`modalOpenRef`。
- 输入校验与一致性：
  - 新增 `generateGroupId`、`validateGroupName` 工具方法；校验空白/长度/控制字符/换行。
  - 统一 ID 生成，去重同名逻辑保留。
- 注释与可读性：统一改为英文注释。
- 测试补充：为 `groupHelpers` 与 `textHelpers` 增加基础单测覆盖。

## 交互说明（避免与“模型置顶”混淆）
- “置顶分组”仅影响 `@` 快速面板中“分组条目”的排序（置顶优先，其余按名称升序）。
- “置顶模型”是独立能力，用于模型选择弹窗与面板中展示“置顶模型”分组，不会与“置顶分组”互相覆盖或冲突。
- 后续若仍有混淆，可按产品决策隐藏分组的置顶按钮，仅保留模型层面的置顶功能。

## 决策与权衡
- 文案/i18n：为避免缺失翻译键导致渲染异常，新加文案暂用英文常量；后续可补齐 i18n。
- 删除分组：直接删除无确认弹窗，简化操作；若需防误删可后续加确认。
- 选择冲突：整组切换逐项复用 `onMentionModel` 逻辑，保持与单选一致的限制与副作用（如视觉模型限制）。
 - 交互一致性：按钮常显可点，依赖动作内部校验保证安全，规避 QuickPanel 列表项 `disabled` 状态不随选择变更的问题；并在无选择时提示“Please select at least one model”。

## 结果
- 本次产出：
  - 修改 `src/renderer/src/pages/home/Inputbar/MentionModelsButton.tsx`
    - 读取/保存 `mention:modelGroups`
    - 渲染分组条目、整组切换、删除分组（带确认）
    - 支持分组置顶/取消置顶（优先显示）与重命名
    - 新增“Save selection as group...”入口；修复其禁用态不刷新的问题，并加入空选择提示
  - 分组结构：`{ id: string; name: string; modelIds: string[] }`
  - 新增工具：
    - `src/renderer/src/utils/groupHelpers.ts`：`generateGroupId`、`validateGroupName`
    - `src/renderer/src/utils/textHelpers.ts`：`removeAtSymbolAndText`
    - 在 `utils/index.ts` 对外导出
  - 新增测试：
    - `src/renderer/src/utils/__tests__/groupHelpers.test.ts`
    - `src/renderer/src/utils/__tests__/textHelpers.test.ts`
  - i18n：保留原有键；新增提示类文案暂使用英文回退（后续补齐 i18n 键值）。
- 验证情况：待本地环境运行 UI 交互验证。

## 后续事项
- 排序管理：支持分组自定义拖拽排序并持久化顺序。
- 测试：添加 e2e 覆盖 `@` 面板分组选择/保存/删除/重命名核心路径；补充 DB 错误分支与并发场景单测。
- 性能：如模型列表较大，引入列表虚拟化（或将 `buildModelItems` 按分区拆分与更细粒度 memo）。
- 状态管理：考虑将与 refs 相关的状态合并到 `useReducer` 简化同步问题。
- 交互增强：可选的乐观更新、加载态提示、快捷键（重命名/删除/保存）等。
