# Knowledge UI 组件结构重构方案（SOLID）

## 概述

本方案只重构 `/src/renderer/src/pages/knowledge/` 的组件结构与职责划分，不做 UI 库迁移、不修改样式与交互行为。核心目标是按 SOLID 原则拆分职责、降低耦合、提高可维护性与扩展性。

## 范围

- In: Knowledge 页面组件拆分、hooks 抽取、共享 UI 结构复用、工具函数集中化、目录结构整理
- Out: antd/styled-components 迁移、UI 视觉改动、数据协议或业务流程改动、新功能新增

## 现状问题（摘要）

- `KnowledgeContent` 集中了数据获取、队列处理、IPC 监听、视图渲染等多重职责
- `items/*` 依赖 `KnowledgeContent` 导出的样式组件，形成反向依赖与耦合
- 时间格式化、列表排序等通用逻辑在多个 item 文件中重复出现
- 右键菜单、快捷键、队列状态等跨域逻辑散落在页面组件中，不易复用或测试
- 层级结构不清晰，新增 item 类型需要修改多个文件

## 目标结构（建议）

```
src/renderer/src/pages/knowledge/
  KnowledgePage.tsx
  KnowledgeContent.tsx
  components/
    KnowledgeSideNav.tsx
    KnowledgeHeader.tsx
    KnowledgeTabs.tsx
    KnowledgeItemLayout.tsx
  hooks/
    useKnowledgeBaseSelection.ts
    useKnowledgeBaseMenu.ts
    useKnowledgeQueueActions.ts
    useKnowledgeProgress.ts
    useKnowledgeTabs.ts
  items/
    KnowledgeFiles.tsx
    KnowledgeNotes.tsx
    KnowledgeDirectories.tsx
    KnowledgeUrls.tsx
    KnowledgeSitemaps.tsx
  utils/
    time.ts
    knowledgeGroups.ts
    knowledgeItems.ts
```

> 实际路径可按现有目录微调，核心是职责分层与依赖方向单向化。

## 模块职责划分（对应 SOLID）

- KnowledgePage（SRP）
  - 只负责页面级容器与布局编排
  - 使用 `useKnowledgeBaseSelection` 获取选中项
  - 使用 `KnowledgeSideNav` 与 `KnowledgeContent` 组合页面

- KnowledgeSideNav（SRP + ISP）
  - 只负责左侧列表渲染
  - 右键菜单与动作来自 `useKnowledgeBaseMenu`
  - 不直接调用数据层

- KnowledgeContent（SRP + DIP）
  - 只负责中间区域结构（Header + Tabs + Items）
  - 数据与副作用通过 hooks 注入
  - 不输出供 items 复用的样式组件

- KnowledgeItemLayout（SRP）
  - 承载 item 区域共用布局：Header、Empty、Container、统一按钮样式
  - items 只依赖该布局组件，不依赖 `KnowledgeContent`

- useKnowledgeBaseSelection（SRP）
  - 封装 bases 列表、选中 id、添加/编辑/删除后的选中逻辑

- useKnowledgeBaseMenu（SRP + ISP）
  - 仅生成菜单项与动作回调
  - 与 UI 解耦，便于复用与单测

- useKnowledgeQueueActions（SRP）
  - 处理 orphan 队列状态、recover/ignore 行为与 toast 反馈

- useKnowledgeProgress（SRP）
  - 统一 IPC 监听与进度 map 管理，避免重复订阅

- useKnowledgeTabs（OCP）
  - 以配置方式注册 tabs
  - 新增 item 类型只新增配置，不需要修改 `KnowledgeContent`

## 迁移步骤（建议按阶段执行）

1. 建立目标目录与空壳文件（不改行为）
2. 抽出共享布局 `KnowledgeItemLayout`，让 `items/*` 改为引用该布局
3. 抽取 `useKnowledgeProgress`，从 `KnowledgeContent` 移除 IPC 监听与 Map 状态
4. 抽取 `useKnowledgeQueueActions`，集中 orphan 检测与处理逻辑
5. 抽取 `useKnowledgeBaseSelection` 与 `useKnowledgeBaseMenu`，简化 `KnowledgePage`
6. 抽取 `useKnowledgeTabs`，让 tabs 由配置生成（OCP）
7. 集中通用工具方法到 `utils/`（时间格式、聚合状态、列表排序等）
8. 清理非规范日志（移除 `console.log`，统一用 `loggerService`）

## 风险与回滚

- 风险：useEffect 依赖迁移导致状态更新时机变化
- 风险：IPC 解绑遗漏导致重复监听或内存泄露
- 风险：抽取 hooks 后数据刷新 key 变化导致 UI 不更新
- 回滚：每阶段独立提交，逐步回退到上一稳定状态

## 验证方式

- `pnpm lint`
- `pnpm test`
- `pnpm format`
- 手动检查 Knowledge 页面：切换知识库、添加/删除、队列恢复、搜索弹窗

---

# 附录 A：Knowledge 页面 UI 迁移评估（历史）

## 概述

评估 `/src/renderer/src/pages/knowledge/` 目录从 antd 迁移到 `@cherrystudio/ui` 的可行性。

---

## 组件对比评估

### ✅ 可直接迁移的组件 (7 个)

| antd 组件   | @cherrystudio/ui 替代 | 迁移难度 | 备注                                      |
| ----------- | --------------------- | -------- | ----------------------------------------- |
| **Button**  | `Button`              | 🟢 低    | API 基本一致                              |
| **Input**   | `Input`               | 🟢 低    | 需调整 `variant="borderless"` → className |
| **Tag**     | `Badge` / `CustomTag` | 🟢 低    | 样式略有不同                              |
| **Select**  | `Select` / `Combobox` | 🟢 低    | API 类似                                  |
| **Spin**    | `Spinner`             | 🟢 低    | 直接替换                                  |
| **Tooltip** | `Tooltip`             | 🟢 低    | 已在项目中使用                            |
| **Slider**  | `Slider`              | 🟢 低    | ✅ **已支持 marks**                       |

### 🟡 需要适配的组件 (5 个)

| antd 组件           | @cherrystudio/ui 替代 | 迁移难度 | 备注                                  |
| ------------------- | --------------------- | -------- | ------------------------------------- |
| **Modal**           | `Dialog`              | 🟡 中    | 需重构为 Radix 组合式 API             |
| **Tabs**            | `Tabs`                | 🟡 中    | 支持 `variant="line"`，API 不同需重写 |
| **Upload/Dragger**  | `Dropzone`            | 🟡 中    | 基于 react-dropzone，API 不同         |
| **Dropdown (选择)** | `Select` / `Combobox` | 🟡 中    | 适用于普通下拉选择                    |
| **Typography**      | 原生 HTML + Tailwind  | 🟡 中    | 使用 `<p>`, `<span>` + Tailwind 类    |

### ⚠️ 需要新增的组件 (6 个)

| antd 组件               | 问题                | 建议方案                            | 优先级 |
| ----------------------- | ------------------- | ----------------------------------- | ------ |
| **Dropdown (右键菜单)** | UI 库无 ContextMenu | 新增 `ContextMenu` (基于 Radix)     | 🔴 高  |
| **Collapse**            | UI 库无对应组件     | 新增 `Accordion` (基于 Radix)       | 🔴 高  |
| **Progress (circle)**   | UI 库无圆形进度条   | 新增 `CircularProgress` (SVG)       | 🔴 高  |
| **Alert**               | UI 库无对应组件     | 新增 `Alert`                        | 🟡 中  |
| **Empty**               | UI 库无对应组件     | 新增 `Empty`                        | 🟡 中  |
| **InputNumber**         | UI 库无对应组件     | 新增或用 `Input type="number"` 适配 | 🟢 低  |

### 其他组件

| antd 组件   | 处理方案                                       |
| ----------- | ---------------------------------------------- |
| **List**    | 用 `div` + `ListItem` 组合                     |
| **Divider** | 已有 `DividerWithText`，可用 `<hr>` + Tailwind |

---

## 组件详细对比

### Slider (✅ 已确认可直接迁移)

```tsx
// antd
<Slider min={1} max={50} marks={{ 1: '1', 6: 'Default', 30: '30' }} />

// @cherrystudio/ui - 支持 marks!
<Slider
  min={1}
  max={50}
  marks={[
    { value: 1, label: '1' },
    { value: 6, label: 'Default' },
    { value: 30, label: '30' }
  ]}
/>
```

### Tabs (✅ 支持 line 变体)

```tsx
// antd
<Tabs activeKey={key} onChange={setKey} items={items} type="line" size="small" />

// @cherrystudio/ui
<Tabs value={key} onValueChange={setKey} variant="line">
  <TabsList>
    <TabsTrigger value="files">Files</TabsTrigger>
    <TabsTrigger value="notes">Notes</TabsTrigger>
  </TabsList>
  <TabsContent value="files">...</TabsContent>
</Tabs>
```

### Dropzone vs Upload.Dragger

```tsx
// antd Upload.Dragger
<Upload.Dragger
  customRequest={({ file }) => handleDrop([file])}
  multiple={true}
  accept={fileTypes.join(',')}
>
  <p>Drag files here</p>
</Upload.Dragger>

// @cherrystudio/ui Dropzone
<Dropzone
  onDrop={(files) => handleDrop(files)}
  maxFiles={99}
  accept={{ 'application/pdf': ['.pdf'], ... }}
>
  <DropzoneEmptyState />
</Dropzone>
```

---

## 缺失组件需求规格

### 1. ContextMenu (右键菜单) - 🔴 高优先级

**使用场景**：KnowledgePage.tsx, KnowledgeUrls.tsx (3 处使用)

```tsx
// 期望 API
<ContextMenu>
  <ContextMenuTrigger asChild>
    <div>右键点击我</div>
  </ContextMenuTrigger>
  <ContextMenuContent>
    <ContextMenuItem onClick={...}>编辑</ContextMenuItem>
    <ContextMenuSeparator />
    <ContextMenuItem onClick={...}>删除</ContextMenuItem>
  </ContextMenuContent>
</ContextMenu>
```

**实现方案**：基于 `@radix-ui/react-context-menu`

### 2. Accordion (折叠面板) - 🔴 高优先级

**使用场景**：KnowledgeDirectories.tsx

```tsx
// 期望 API
<Accordion type="multiple" defaultValue={["item-1", "item-2"]}>
  <AccordionItem value="item-1">
    <AccordionTrigger>标题</AccordionTrigger>
    <AccordionContent>内容</AccordionContent>
  </AccordionItem>
</Accordion>
```

**实现方案**：基于 `@radix-ui/react-accordion`

### 3. CircularProgress (圆形进度条) - 🔴 高优先级

**使用场景**：StatusIcon.tsx

```tsx
// 期望 API
<CircularProgress value={75} size={14} strokeColor="var(--color-primary)" />
```

**实现方案**：SVG 实现，参考 Shadcn/UI 社区方案

### 4. Alert - 🟡 中优先级

**使用场景**：AdvancedSettingsPanel.tsx

```tsx
// 期望 API
<Alert variant="warning">
  <AlertIcon />
  <AlertDescription>警告信息</AlertDescription>
</Alert>
```

### 5. Empty - 🟡 中优先级

**使用场景**：KnowledgePage.tsx, KnowledgeContent.tsx

```tsx
// 期望 API
<Empty image="simple" description="暂无数据" />
```

---

## 迁移复杂度分析

### 高复杂度文件 (需重构)

| 文件                         | 原因                      | 依赖缺失组件       |
| ---------------------------- | ------------------------- | ------------------ |
| `KnowledgeBaseFormModal.tsx` | Modal + styled-components | -                  |
| `KnowledgeDirectories.tsx`   | Collapse + CSS 自定义     | Accordion          |
| `KnowledgeSearchPopup.tsx`   | Modal + Input + List      | -                  |
| `StatusIcon.tsx`             | 圆形 Progress             | CircularProgress   |
| `KnowledgePage.tsx`          | 右键菜单 + Empty          | ContextMenu, Empty |
| `KnowledgeUrls.tsx`          | 右键菜单                  | ContextMenu        |

### 中复杂度文件

| 文件                        | 原因                         | 依赖缺失组件 |
| --------------------------- | ---------------------------- | ------------ |
| `KnowledgeContent.tsx`      | Tabs + Tag + Empty           | Empty        |
| `AdvancedSettingsPanel.tsx` | InputNumber + Select + Alert | Alert        |
| `GeneralSettingsPanel.tsx`  | Slider with marks            | -            |
| `KnowledgeFiles.tsx`        | Upload/Dragger               | -            |

### 低复杂度文件 (可直接迁移)

| 文件           | 原因                  |
| -------------- | --------------------- |
| `QuotaTag.tsx` | 仅 Tag → Badge        |
| `TextItem.tsx` | Typography → Tailwind |

---

## 统计汇总

| 分类                   | 数量 | 详情                                                                |
| ---------------------- | ---- | ------------------------------------------------------------------- |
| Knowledge 目录文件总数 | 13   | tsx 文件                                                            |
| 使用的 antd 组件       | 18   | 不重复计数                                                          |
| 可直接迁移             | 7    | Button, Input, Tag, Select, Spin, Tooltip, Slider                   |
| 需要适配               | 5    | Modal, Tabs, Upload, Dropdown(选择), Typography                     |
| 需要新增               | 6    | ContextMenu, Accordion, CircularProgress, Alert, Empty, InputNumber |

---

## 迁移策略（已确认）

- **缺失组件**：暂时保留 antd，仅迁移已有组件
- **styled-components**：迁移时一并移除，改用 Tailwind CSS

---

## 可迁移文件清单

根据策略，以下文件可以完整迁移（不依赖缺失组件）：

### ✅ 可完整迁移 (4 个文件)

| 文件                       | 迁移内容                  | 难度  |
| -------------------------- | ------------------------- | ----- |
| `QuotaTag.tsx`             | Tag → Badge               | 🟢 低 |
| `TextItem.tsx`             | Typography → Tailwind     | 🟢 低 |
| `GeneralSettingsPanel.tsx` | Slider (marks) + Input    | 🟡 中 |
| `KnowledgeFiles.tsx`       | Upload.Dragger → Dropzone | 🟡 中 |

### 🟡 可部分迁移 (4 个文件)

| 文件                         | 可迁移                    | 保留 antd    | 难度    |
| ---------------------------- | ------------------------- | ------------ | ------- |
| `KnowledgeContent.tsx`       | Tabs, Tag                 | Empty        | 🟡 中   |
| `AdvancedSettingsPanel.tsx`  | Select, InputNumber(适配) | Alert        | 🟡 中   |
| `KnowledgeSearchPopup.tsx`   | Modal→Dialog, Input       | List(用 div) | 🟠 中高 |
| `KnowledgeBaseFormModal.tsx` | Modal→Dialog, 移除 styled | -            | 🟠 中高 |

### ❌ 暂不迁移 (4 个文件)

| 文件                       | 原因                     |
| -------------------------- | ------------------------ |
| `KnowledgePage.tsx`        | 依赖 ContextMenu + Empty |
| `KnowledgeUrls.tsx`        | 依赖 ContextMenu         |
| `KnowledgeDirectories.tsx` | 依赖 Accordion           |
| `StatusIcon.tsx`           | 依赖 CircularProgress    |

---

## 执行计划

### 第一步：低难度文件

1. ✅ `QuotaTag.tsx` - Tag → Badge
2. ✅ `TextItem.tsx` - Typography → Tailwind

### 第二步：中难度文件

3. ✅ `GeneralSettingsPanel.tsx` - Slider + Input
4. ✅ `KnowledgeFiles.tsx` - Upload → Dropzone
5. ✅ `KnowledgeContent.tsx` - Tabs + Tag (保留 Empty)
6. ✅ `AdvancedSettingsPanel.tsx` - Select (保留 Alert)

### 第三步：中高难度文件

7. ✅ `KnowledgeSearchPopup.tsx` - Modal → Dialog
8. ✅ `KnowledgeBaseFormModal.tsx` - Modal → Dialog + 移除 styled-components

### 第四步：补充迁移

9. ✅ `components.tsx` - Typography → Tailwind + CopyOutlined → lucide Copy

### 验证方式

- 运行 `pnpm lint` 检查类型错误
- 运行 `pnpm test:renderer` 确保测试通过
- 手动测试 Knowledge 页面功能

---

## 迁移进度

**已完成**: 9/9 文件 ✅

### 已完成的迁移

1. ✅ `QuotaTag.tsx` - Tag → Badge
2. ✅ `TextItem.tsx` - Typography → Tailwind
3. ✅ `GeneralSettingsPanel.tsx` - Slider + Input
4. ✅ `KnowledgeFiles.tsx` - Upload → Dropzone
5. ✅ `KnowledgeContent.tsx` - Tabs + Tag (保留 Empty)
6. ✅ `AdvancedSettingsPanel.tsx` - Select (保留 Alert)
7. ✅ `KnowledgeSearchPopup.tsx` - Modal → Dialog
8. ✅ `KnowledgeBaseFormModal.tsx` - Modal → Dialog + 移除 styled-components
9. ✅ `components.tsx` - Typography → Tailwind + CopyOutlined → lucide Copy

### 已修复的类型错误

1. ✅ `useKnowledgeBaseForm.v2.ts` - `docPreprocessSelectOptions` 类型修复为 `SelectOption[]`
2. ✅ `KnowledgeBaseFormModal.tsx` - 添加 `afterClose` 属性支持
3. ✅ `KnowledgeSearchPopup.tsx` - Spinner 添加 `text` 属性

### 待迁移 (需要新增 UI 组件)

| 文件                       | 依赖缺失组件             |
| -------------------------- | ------------------------ |
| `KnowledgePage.tsx`        | ContextMenu + Empty      |
| `KnowledgeUrls.tsx`        | ContextMenu              |
| `KnowledgeDirectories.tsx` | Accordion                |
| `StatusIcon.tsx`           | CircularProgress         |
