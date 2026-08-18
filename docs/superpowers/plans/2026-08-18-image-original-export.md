# 图片另存为原始字节实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 未旋转/翻转时让“另存为”保存原图字节与格式，变换后仍保存正确的 PNG，并完全不修改复制粘贴行为。

**架构：** ImageViewer 继续用 `getImageBlobFromSource` 统一解析来源，但无像素变换时直接通过现有 `window.api.file.save` 保存 Blob 的二进制内容。需要像素变换时复用 `transformImageToPng`，再通过同一二进制保存 API 输出 `.png`；不新增 IPC 或 main-process 改动。

**技术栈：** React、TypeScript、Vitest、Testing Library、mime-types、Electron preload binary save API。

---

## 文件结构

- 修改：`src/renderer/components/__tests__/ImageViewer.test.tsx` — 覆盖原字节/格式与变换 PNG 两条保存契约。
- 修改：`src/renderer/components/ImageViewer.tsx` — 选择原始或变换 Blob、解析扩展名并二进制保存。

### 任务 1：用组件测试复现重新编码问题

**文件：**
- 测试：`src/renderer/components/__tests__/ImageViewer.test.tsx`

- [ ] **步骤 1：扩展保存 API mock**

为 hoisted mocks 增加 `save: vi.fn()`，并将 `window.api.file` 设置为同时包含 `save` 与现有 `saveImage`。每次测试将 `save` resolve 为目标路径字符串。

- [ ] **步骤 2：将无变换用例改为原始 WebP 契约**

用 `data:image/webp;base64,aGVsbG8=` 触发 Save As，并断言：

```ts
expect(mocks.save).toHaveBeenCalledWith('Example image.webp', new Uint8Array([104, 101, 108, 108, 111]))
expect(mocks.saveImage).not.toHaveBeenCalled()
```

- [ ] **步骤 3：将变换用例改为 PNG 二进制契约**

保留对 `transformImageToPng` 的参数断言，并断言保存文件名为 `Example image.png`、内容为 `transformed` 对应的 UTF-8 字节。

- [ ] **步骤 4：运行测试并确认按预期失败**

运行：

```bash
pnpm exec vitest run --project renderer src/renderer/components/__tests__/ImageViewer.test.tsx
```

预期：FAIL；当前实现只调用 PNG-only `saveImage`，不会调用二进制 `save`。

### 任务 2：最小化实现原始格式保存

**文件：**
- 修改：`src/renderer/components/ImageViewer.tsx`

- [ ] **步骤 1：添加扩展名解析**

导入 `mime-types`，将当前文件名 helper 拆成无扩展名基名与扩展名解析。扩展名优先使用 `mime.extension(blob.type)`，其次使用 alt/source URL 中受支持的图像扩展名，最后返回 `bin`；JPEG 统一建议 `.jpg`。

- [ ] **步骤 2：替换保存分支**

将保存核心改为：

```ts
const transformed = rotation % 360 !== 0 || flipX || flipY
const outputBlob = transformed ? await transformImageToPng(blob, { flipX, flipY, rotation }) : blob
const extension = transformed ? 'png' : getImageExtension(item, outputBlob)
const bytes = new Uint8Array(await outputBlob.arrayBuffer())
const saved = await window.api.file.save(`${getImageSaveName(item)}.${extension}`, bytes)
```

删除不再使用的 `blobToDataUrl` 与 `convertImageToPng` imports。不要修改 `handleCopyImage`、`copyImageToClipboard` 或 clipboard tests。

- [ ] **步骤 3：运行定向测试**

运行：

```bash
pnpm exec vitest run --project renderer src/renderer/components/__tests__/ImageViewer.test.tsx
```

预期：全部 PASS，包括现有复制图片/复制来源测试。

### 任务 3：校验并提交

**文件：**
- 检查：本计划列出的全部修改文件。

- [ ] **步骤 1：运行仓库非全量测试校验**

运行 `pnpm format`、`pnpm lint`、`pnpm build:check`。按用户要求不运行全量 `pnpm test`。

- [ ] **步骤 2：审查 diff**

确认生产代码只修改 ImageViewer 的另存为路径，未修改复制、粘贴、IPC、main process 或 UI 文案。

- [ ] **步骤 3：签名提交**

```bash
git add docs/superpowers src/renderer/components/ImageViewer.tsx src/renderer/components/__tests__/ImageViewer.test.tsx
git commit -S --signoff -m "fix(image-export): preserve original image bytes"
git cat-file commit HEAD | rg '^gpgsig '
```

预期：提交成功并包含 `gpgsig` 与 `Signed-off-by`。
