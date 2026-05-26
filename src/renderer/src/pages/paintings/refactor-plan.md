# Paintings 可执行重构计划

## 范围

本计划基于完整阅读 `src/renderer/src/pages/paintings` 下的代码：

- Provider 页面：`AihubmixPage.tsx`、`DmxapiPage.tsx`、`NewApiPage.tsx`、`OvmsPage.tsx`、`PpioPage.tsx`、`SiliconPage.tsx`、`TokenFluxPage.tsx`、`ZhipuPage.tsx`
- 路由入口：`PaintingsRoutePage.tsx`
- 公共组件：`Artboard.tsx`、`DynamicFormRender.tsx`、`ImageUploader.tsx`、`PaintingsList.tsx`、`ProviderSelect.tsx`
- Provider 配置：`config/*`
- 工具和测试：`utils/*`

前提假设：

- 除非某个阶段明确标记为 bug fix，否则不改 provider 行为。
- 优先做小步、可 review、可回滚的重构，不一开始做大的 provider 框架重写。
- UI 收敛阶段不改现有 `usePaintings` / DataApi 存储行为；文件引用和存储迁移应作为独立任务处理。
- 新 UI 代码继续使用 Tailwind CSS 和 `@cherrystudio/ui`，不新增 styled-components 或新的 Ant Design-only 封装。

## 值得重构的问题

### 1. 页面壳重复

每个 provider 页面都重复了同一套结构：`Navbar`、左侧设置面板、provider 选择器、中间画布、底部 prompt 输入框、右侧历史列表。现在任何布局调整都需要在多个页面同步修改。

建议抽取：

- `components/PaintingPageShell.tsx`
- `components/PaintingSettingsPane.tsx`
- `components/PaintingPromptBar.tsx`

### 2. painting 生命周期状态重复

大多数页面都重复实现了这些逻辑：

- `updatePaintingState`
- `getNewPainting`
- `handleAddPainting`
- `onDeletePainting`
- `onSelectPainting`
- `nextImage`
- `prevImage`
- `onCancel`

建议抽成 hook，把当前 painting、当前图片 index、loading/generating、abort controller、增删选历史项等状态放在一起。

建议新增：

- `hooks/usePaintingSession.ts`

### 3. prompt 翻译逻辑重复

`AihubmixPage`、`NewApiPage`、`OvmsPage`、`PpioPage`、`SiliconPage`、`TokenFluxPage` 都有类似的“三次空格翻译”逻辑：`spaceClickCount`、`spaceClickTimer`、`isTranslating`、`translateText`、unmount cleanup。生成快捷键应由 prompt bar 统一处理，空格触发条件也应保持一致。

建议新增：

- `hooks/usePaintingPromptTranslation.ts`

该 hook 只负责 prompt 翻译状态和空格计时；Enter 生成行为由 `PaintingPromptBar` 统一处理。

### 4. 图片下载、base64 保存和 FileManager 持久化重复

这些流程在多个页面里重复出现：

- 跳过空 URL
- 提示 `message.empty_url`
- 通过 `window.api.file.download` 下载 URL
- 通过 `window.api.file.saveBase64Image` 保存 base64
- 过滤 `null`
- 调用 `FileManager.addFiles`
- 更新 painting 的 `files` / `urls`

涉及文件包括 `AihubmixPage`、`DmxapiPage`、`NewApiPage`、`OvmsPage`、`PpioPage`、`SiliconPage`、`TokenFluxService`、`ZhipuPage`。

建议新增：

- `utils/imageFiles.ts`

建议函数：

- `downloadPaintingUrls(urls, options)`
- `savePaintingBase64Images(base64s, options)`
- `saveGeneratedPaintingFiles({ urls, base64s })`

### 5. provider 请求逻辑混在 React 页面里

几个大页面同时承担了 UI、状态、请求构造、网络请求、响应解析、文件保存：

- `AihubmixPage.tsx` 里有 Aihubmix、Gemini、Ideogram、OpenAI、Flux 多分支。
- `DmxapiPage.tsx` 里有动态模型加载、请求构造、请求执行、图片下载和 UI。
- `NewApiPage.tsx`、`SiliconPage.tsx`、`PpioPage.tsx` 也把 provider API 逻辑混在组件内。

建议逐步移动到：

- `providers/aihubmix/`
- `providers/dmxapi/`
- `providers/newApi/`
- `providers/ovms/`
- `providers/ppio/`
- `providers/silicon/`
- `providers/tokenFlux/`
- `providers/zhipu/`

第一步只移动纯请求/响应 helper，不要立刻抽象一个通用 provider engine。至少迁移两个 provider 后，再判断是否真的需要更高层抽象。

### 6. 配置表单渲染重复但不统一

`AihubmixPage`、`OvmsPage`、`PpioPage` 都有相似的 config schema 渲染逻辑。`DynamicFormRender.tsx` 也是 schema renderer，但目前有 inline style、`any`、硬编码英文错误提示等问题。

建议新增：

- `form/PaintingFieldRenderer.tsx`
- `form/types.ts`
- `form/fieldUtils.ts`

第一步只支持现有字段类型：`select`、`slider`、`input`、`inputNumber`、`textarea`、`switch`、`image`。

### 7. 类型过松

明显例子：

- `ZhipuPage.tsx` 的 painting state 和 handler 使用 `any`。
- `TokenFluxPage.tsx` 使用 `Record<string, any>` 表达 schema 和 form value。
- `DmxapiPage.tsx` 的 model group、request config 使用 `any`。
- `DynamicFormRender.tsx` 的 schema/value/onChange 都是 `any`。
- `PaintingsState` 里存在类似 `Partial<GeneratePainting> & PaintingParams[]` 的类型，语义像“对象和数组的交集”，可读性和类型约束都不好。

建议先收紧 page-local 类型，再单独做共享类型修正。

### 8. 仍有 inline style 和硬编码可见文案

典型例子：

- `DynamicFormRender.tsx` 使用大量 inline layout style，并硬编码 `"Invalid image URL format"`。
- `ImageUploader.tsx` 和 `AihubmixPage.tsx` 使用 Tailwind pseudo-content 硬编码 `"点击替换"`。
- Aihubmix 图片预览 `alt` 有硬编码中文。
- 多个页面重复 `style={{ width: '100%' }}`、margin、icon color。

这些适合做低风险 UI-only 清理。

### 9. provider 路由切换逻辑重复

`PaintingsRoutePage.tsx` 负责 provider 路由，但每个页面又重复了 `handleProviderChange`：读取当前 route name，比较 provider id，再 navigate。

建议新增：

- `hooks/usePaintingProviderNavigation.ts`

### 10. 重复逻辑里藏着潜在正确性风险

这些不要混进机械重构里，应先补测试或单独修：

- 有些页面会在所有校验完成前删除旧文件。
- 有些页面在 early return 前已经设置 loading/generating。
- 下载 helper 有些返回过滤后的 `FileMetadata[]`，有些返回未过滤的数组。
- 删除最后一条历史时，有些页面会创建默认 painting，有些不会。
- 上传图片使用 `URL.createObjectURL` 后没有统一 revoke。

## 可执行阶段

### Phase 1：抽取共享页面结构

目标：减少重复页面壳，不改 provider 请求逻辑。

步骤：

1. 新增 `components/PaintingPageShell.tsx`
   - props：`title`、`onAddPainting`、`showAddButton`、`settings`、`main`、`history`
   - 内部渲染 `Navbar`、macOS 新建按钮、`content-container`、左侧设置区、中间主区、右侧历史区
   - 验证：先迁移最小页面 `ZhipuPage.tsx`，截图或手动检查布局一致

2. 新增 `components/PaintingPromptBar.tsx`
   - props：`value`、`disabled`、`placeholder`、`textareaRef`、`onChange`、`onKeyDown`、`onGenerate`、可选翻译按钮配置
   - 保持当前高度、padding、toolbar 对齐和按钮行为不变
   - 验证：迁移 `ZhipuPage.tsx`、`SiliconPage.tsx`、`TokenFluxPage.tsx`

3. 新增 `components/PaintingSettingsPane.tsx`
   - props：`children`、可选 `className`
   - 保持现有宽度、边框、滚动行为不变

预期改动：

- 新增三个组件文件
- 分批更新 provider 页面

### Phase 2：抽取 painting session hook

目标：集中管理当前 painting、当前图片 index、loading/generating、abort、增删选历史项。

步骤：

1. 新增 `hooks/usePaintingSession.ts`
   - 输入：namespace、paintings、default factory、`addPainting`、`removePainting`、`updatePainting`、`generating`
   - 输出：`painting`、`setPainting`、`updatePaintingState`、`addNewPainting`、`deletePainting`、`selectPainting`、`currentImageIndex`、`nextImage`、`prevImage`、`isLoading`、`setIsLoading`、`abortController`、`startAbortableRun`、`cancelRun`
   - 对 DMXAPI auto-create、NewAPI provider 过滤等特殊行为保留注入点

2. 先迁移 `ZhipuPage.tsx`
   - 验证：新增、选择、删除、生成、取消、删除到空列表后重建默认项都不变

3. 再迁移 `SiliconPage.tsx`、`OvmsPage.tsx`、`TokenFluxPage.tsx`
   - 验证：provider 切换、历史列表、生成流程保持一致

4. 最后再评估 `AihubmixPage.tsx`、`NewApiPage.tsx`、`PpioPage.tsx`、`DmxapiPage.tsx`
   - 这些页面有 mode 相关逻辑，不要盲目迁移

### Phase 3：抽取 prompt 翻译 hook

目标：移除重复的三次空格翻译实现。

步骤：

1. 新增 `hooks/usePaintingPromptTranslation.ts`
   - 输入：`prompt`、`enabled`、`onTranslated`、可选 `resetDelayMs`、可选 `triggerCount`
   - 输出：`isTranslating`、`handleKeyDown`

2. 先迁移行为一致的页面：
   - `AihubmixPage.tsx`
   - `NewApiPage.tsx`
   - `OvmsPage.tsx`
   - `SiliconPage.tsx`
   - `TokenFluxPage.tsx`

3. 单独迁移 `PpioPage.tsx`
   - 移除页面内 Enter 生成逻辑，复用 `PaintingPromptBar`

验证：

- 三次空格仍能更新 prompt
- `TranslateButton` 仍能工作
- Enter 生成由 `PaintingPromptBar` 统一处理，输入法组合态不会误触发
- unmount 时 timer 清理不变

### Phase 4：抽取图片文件工具并补测试

目标：统一 URL 下载、base64 保存、FileManager 持久化。

步骤：

1. 新增 `utils/imageFiles.ts`
   - `downloadPaintingUrls(urls, t, options?)`
   - `savePaintingBase64Images(base64s)`
   - `saveGeneratedPaintingFiles({ urls, base64s })`
   - 内部过滤 `null`，只返回 `FileMetadata[]`

2. 新增 `utils/__tests__/imageFiles.test.ts`
   - 空 URL 返回空文件并触发 warning
   - URL 下载调用 `window.api.file.download`
   - base64 调用 `window.api.file.saveBase64Image`
   - invalid URL 错误被一致处理

3. 迁移顺序：
   - `OvmsPage.tsx`
   - `NewApiPage.tsx`
   - `SiliconPage.tsx`
   - `TokenFluxService.ts`
   - `AihubmixPage.tsx`
   - `DmxapiPage.tsx`
   - `PpioPage.tsx`
   - `ZhipuPage.tsx`

验证：

```bash
pnpm test -- src/renderer/src/pages/paintings/utils/__tests__
pnpm test
```

### Phase 5：拆出 provider 请求逻辑

目标：让 React 页面主要负责组合 UI 和调用 provider module。

步骤：

1. 从 `SiliconPage.tsx` 开始
   - 移动 model 常量和请求 helper 到 `providers/silicon/`
   - 页面内只保留 React 状态和事件组合
   - 补请求 body、endpoint、响应解析测试

2. 拆 `NewApiPage.tsx`
   - 移动 URL 构造、body/header 构造到 `providers/newApi/`
   - 测试普通 provider 和 `aionly` URL 分支

3. 拆 `DmxapiPage.tsx`
   - 移动动态模型解析和 request config 构造到 `providers/dmxapi/`
   - 顺手把 `GetModelGroup` 改成 `getModelGroup`
   - 把 `onbeforeunload` 改成真实动作名，例如 `handleImageUpload`

4. 拆 `AihubmixPage.tsx`
   - 先拆 Gemini 和 Ideogram V3 分支
   - 如果单文件过大，可以一条 API 分支一个 helper 文件

5. 保留 `PpioService.ts`、`TokenFluxService.ts` 的 service 形态
   - 但让下载/保存逻辑使用 Phase 4 的图片工具

验证：

- 为提取出的 request builder 加单测
- `pnpm test`
- 手动 smoke：生成、取消、错误提示、重试下载

### Phase 6：统一配置表单渲染

目标：减少配置 UI 重复，同时保留 provider 自己的配置 schema。

步骤：

1. 新增 `form/types.ts`
   - 定义 `PaintingFieldConfig<TPainting>`，类型化 `key`、`options`、`condition`、`disabled`、`initialValue`

2. 新增 `form/PaintingFieldRenderer.tsx`
   - 支持当前目录已使用的字段类型
   - 优先 Tailwind 和 `@cherrystudio/ui`
   - 对现有强依赖 Ant Design 的 field，先保持 Ant Design 组件

3. 先迁移 `OvmsPage.tsx`
   - 它的 config 最小，风险最低

4. 再迁移 `AihubmixPage.tsx` 和 `PpioPage.tsx`
   - image upload 行为保留注入点

5. 处理 `DynamicFormRender.tsx`
   - 如果 TokenFlux 的 JSON schema 形态可以兼容，就并入 `PaintingFieldRenderer`
   - 如果不能兼容，就明确重命名成 TokenFlux-specific renderer

验证：

- 每个字段类型渲染值不变
- `updatePaintingState` 收到的 key/value 不变
- renderer 中没有硬编码用户可见字符串

### Phase 7：收紧类型

目标：减少 `any`，让 provider 数据契约可 review。

步骤：

1. 增加类型：
   - DMXAPI model groups 和 request config
   - TokenFlux JSON schema property/value
   - Gemini response
   - Aihubmix response

2. 替换 page-local `any`：
   - `ZhipuPage.tsx`
   - `DmxapiPage.tsx`
   - `TokenFluxPage.tsx`
   - `DynamicFormRender.tsx`

3. 单独修正 `src/renderer/src/types/index.ts` 的 `PaintingsState` 数组类型声明

验证：

```bash
pnpm lint
```

要求：迁移过的文件不新增 `as any`。

### Phase 8：UI 和 i18n 清理

目标：完成 styled-components 迁移后的质量收尾，不改行为。

步骤：

1. 把剩余 inline layout style 安全替换为 Tailwind。
2. 替换硬编码用户可见字符串：
   - `"Invalid image URL format"`
   - `"点击替换"`
   - `"预览图"`
   - `"Unknown Provider"` 如果可见
3. 给预览替换、删除等 icon action 补 `aria-label` 或 tooltip。
4. 视觉尺寸不主动调整，除非单独确认。

验证：

```bash
pnpm i18n:check
pnpm lint
```

并手动 smoke：

- 上传图片
- 替换图片
- 删除图片
- prompt 输入框
- 历史列表

## 推荐执行顺序

1. 抽 `PaintingPromptBar` 和页面壳。
2. 抽 `usePaintingPromptTranslation`。
3. 抽 `utils/imageFiles.ts` 并补测试。
4. 拆简单 provider：Silicon、OVMS、NewAPI。
5. 拆复杂 provider：DMXAPI、Aihubmix。
6. 统一 config field renderer。
7. 收紧类型。
8. 做最终 UI/i18n 清理。

## 每阶段通用验证

每个阶段完成后运行：

```bash
pnpm format
pnpm lint
pnpm test
```

涉及 provider 行为时，额外手动检查：

- provider 切换
- model 切换
- prompt 编辑和生成
- 取消生成
- 重新生成确认弹窗
- 历史选择、删除、拖拽排序
- 支持上传的 provider 中上传和替换图片
- `Artboard` 的 URL 重试下载

## 第一 PR 建议

第一轮最稳的 PR 只做：

- 新增 `PaintingPromptBar`
- 迁移 `ZhipuPage.tsx`、`SiliconPage.tsx`、`TokenFluxPage.tsx`
- 不改 provider 请求逻辑
- 不改存储逻辑

这样能先减少明显重复，同时避开 Aihubmix、DMXAPI 这类高风险 API 分支。
