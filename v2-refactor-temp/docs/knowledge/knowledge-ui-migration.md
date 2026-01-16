# Knowledge 页面 UI 迁移评估报告

## 概述

评估 `/src/renderer/src/pages/knowledge/` 目录从 antd 迁移到 `@cherrystudio/ui` 的可行性。

---

## 组件对比评估

### ✅ 可直接迁移的组件 (7个)

| antd 组件 | @cherrystudio/ui 替代 | 迁移难度 | 备注 |
|-----------|----------------------|---------|------|
| **Button** | `Button` | 🟢 低 | API 基本一致 |
| **Input** | `Input` | 🟢 低 | 需调整 `variant="borderless"` → className |
| **Tag** | `Badge` / `CustomTag` | 🟢 低 | 样式略有不同 |
| **Select** | `Select` / `Combobox` | 🟢 低 | API 类似 |
| **Spin** | `Spinner` | 🟢 低 | 直接替换 |
| **Tooltip** | `Tooltip` | 🟢 低 | 已在项目中使用 |
| **Slider** | `Slider` | 🟢 低 | ✅ **已支持 marks** |

### 🟡 需要适配的组件 (5个)

| antd 组件 | @cherrystudio/ui 替代 | 迁移难度 | 备注 |
|-----------|----------------------|---------|------|
| **Modal** | `Dialog` | 🟡 中 | 需重构为 Radix 组合式 API |
| **Tabs** | `Tabs` | 🟡 中 | 支持 `variant="line"`，API 不同需重写 |
| **Upload/Dragger** | `Dropzone` | 🟡 中 | 基于 react-dropzone，API 不同 |
| **Dropdown (选择)** | `Select` / `Combobox` | 🟡 中 | 适用于普通下拉选择 |
| **Typography** | 原生 HTML + Tailwind | 🟡 中 | 使用 `<p>`, `<span>` + Tailwind 类 |

### ⚠️ 需要新增的组件 (6个)

| antd 组件 | 问题 | 建议方案 | 优先级 |
|-----------|------|---------|--------|
| **Dropdown (右键菜单)** | UI 库无 ContextMenu | 新增 `ContextMenu` (基于 Radix) | 🔴 高 |
| **Collapse** | UI 库无对应组件 | 新增 `Accordion` (基于 Radix) | 🔴 高 |
| **Progress (circle)** | UI 库无圆形进度条 | 新增 `CircularProgress` (SVG) | 🔴 高 |
| **Alert** | UI 库无对应组件 | 新增 `Alert` | 🟡 中 |
| **Empty** | UI 库无对应组件 | 新增 `Empty` | 🟡 中 |
| **InputNumber** | UI 库无对应组件 | 新增或用 `Input type="number"` 适配 | 🟢 低 |

### 其他组件

| antd 组件 | 处理方案 |
|-----------|---------|
| **List** | 用 `div` + `ListItem` 组合 |
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

**使用场景**：KnowledgePage.tsx, KnowledgeUrls.tsx (3处使用)

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
<Accordion type="multiple" defaultValue={['item-1', 'item-2']}>
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
<CircularProgress
  value={75}
  size={14}
  strokeColor="var(--color-primary)"
/>
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
<Empty
  image="simple"
  description="暂无数据"
/>
```

---

## 迁移复杂度分析

### 高复杂度文件 (需重构)

| 文件 | 原因 | 依赖缺失组件 |
|------|------|-------------|
| `KnowledgeBaseFormModal.tsx` | Modal + styled-components | - |
| `KnowledgeDirectories.tsx` | Collapse + CSS 自定义 | Accordion |
| `KnowledgeSearchPopup.tsx` | Modal + Input + List | - |
| `StatusIcon.tsx` | 圆形 Progress | CircularProgress |
| `KnowledgePage.tsx` | 右键菜单 + Empty | ContextMenu, Empty |
| `KnowledgeUrls.tsx` | 右键菜单 | ContextMenu |

### 中复杂度文件

| 文件 | 原因 | 依赖缺失组件 |
|------|------|-------------|
| `KnowledgeContent.tsx` | Tabs + Tag + Empty | Empty |
| `AdvancedSettingsPanel.tsx` | InputNumber + Select + Alert | Alert |
| `GeneralSettingsPanel.tsx` | Slider with marks | - |
| `KnowledgeFiles.tsx` | Upload/Dragger | - |

### 低复杂度文件 (可直接迁移)

| 文件 | 原因 |
|------|------|
| `QuotaTag.tsx` | 仅 Tag → Badge |
| `TextItem.tsx` | Typography → Tailwind |

---

## 统计汇总

| 分类 | 数量 | 详情 |
|------|-----|------|
| Knowledge 目录文件总数 | 13 | tsx 文件 |
| 使用的 antd 组件 | 18 | 不重复计数 |
| 可直接迁移 | 7 | Button, Input, Tag, Select, Spin, Tooltip, Slider |
| 需要适配 | 5 | Modal, Tabs, Upload, Dropdown(选择), Typography |
| 需要新增 | 6 | ContextMenu, Accordion, CircularProgress, Alert, Empty, InputNumber |

---

## 迁移策略（已确认）

- **缺失组件**：暂时保留 antd，仅迁移已有组件
- **styled-components**：迁移时一并移除，改用 Tailwind CSS

---

## 可迁移文件清单

根据策略，以下文件可以完整迁移（不依赖缺失组件）：

### ✅ 可完整迁移 (4个文件)

| 文件 | 迁移内容 | 难度 |
|------|---------|------|
| `QuotaTag.tsx` | Tag → Badge | 🟢 低 |
| `TextItem.tsx` | Typography → Tailwind | 🟢 低 |
| `GeneralSettingsPanel.tsx` | Slider (marks) + Input | 🟡 中 |
| `KnowledgeFiles.tsx` | Upload.Dragger → Dropzone | 🟡 中 |

### 🟡 可部分迁移 (4个文件)

| 文件 | 可迁移 | 保留 antd | 难度 |
|------|-------|----------|------|
| `KnowledgeContent.tsx` | Tabs, Tag | Empty | 🟡 中 |
| `AdvancedSettingsPanel.tsx` | Select, InputNumber(适配) | Alert | 🟡 中 |
| `KnowledgeSearchPopup.tsx` | Modal→Dialog, Input | List(用div) | 🟠 中高 |
| `KnowledgeBaseFormModal.tsx` | Modal→Dialog, 移除styled | - | 🟠 中高 |

### ❌ 暂不迁移 (5个文件)

| 文件 | 原因 |
|------|------|
| `KnowledgePage.tsx` | 依赖 ContextMenu + Empty |
| `KnowledgeUrls.tsx` | 依赖 ContextMenu |
| `KnowledgeDirectories.tsx` | 依赖 Accordion |
| `StatusIcon.tsx` | 依赖 CircularProgress |
| `components.tsx` (KnowledgeSearchItem) | Typography，可选迁移 |

---

## 执行计划

### 第一步：低难度文件
1. `QuotaTag.tsx` - Tag → Badge
2. `TextItem.tsx` - Typography → Tailwind

### 第二步：中难度文件
3. `GeneralSettingsPanel.tsx` - Slider + Input
4. `KnowledgeFiles.tsx` - Upload → Dropzone
5. `KnowledgeContent.tsx` - Tabs + Tag (保留 Empty)
6. `AdvancedSettingsPanel.tsx` - Select (保留 Alert)

### 第三步：中高难度文件
7. `KnowledgeSearchPopup.tsx` - Modal → Dialog
8. `KnowledgeBaseFormModal.tsx` - Modal → Dialog + 移除 styled-components

### 验证方式
- 运行 `pnpm lint` 检查类型错误
- 运行 `pnpm test:renderer` 确保测试通过
- 手动测试 Knowledge 页面功能
