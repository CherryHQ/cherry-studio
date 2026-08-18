# Gemini 图像参数投递实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 为稳定版和预览版 Nano Banana 2 恢复智能比例，并可靠暴露 1K、2K、4K 分辨率参数。

**架构：** 仅在 provider registry 的 Google creator 中声明模型能力，继续复用现有表单转换和 Google/Vertex wire profile。`auto` 作为 registry 默认值进入表单，但在线路层被省略，从而由 Gemini 智能匹配；显式值继续映射到 `imageConfig`。

**技术栈：** TypeScript、Zod provider registry、Vitest、现有 catalog generator。

---

## 文件结构

- 修改：`packages/provider-registry/src/__tests__/catalog-invariants.test.ts` — 固定 Nano Banana 2 的用户可见参数契约。
- 修改：`packages/provider-registry/src/creators/google.ts` — 声明稳定版与预览版 Nano Banana 2 的图像生成能力。
- 修改：`packages/provider-registry/data/models.json` — 由 generator 生成的发布目录。

### 任务 1：用目录契约复现缺失参数

**文件：**
- 测试：`packages/provider-registry/src/__tests__/catalog-invariants.test.ts`

- [ ] **步骤 1：编写失败的目录测试**

在 `models` 的测试类型中加入 `imageGeneration`，并断言稳定版与预览版的 `generate.supports` 满足以下契约：

```ts
expect(models.find((model) => model.id === modelId)?.imageGeneration?.modes.generate.supports).toMatchObject({
  aspectRatio: { default: 'auto', options: expect.arrayContaining(['auto', 'ASPECT_1_1']) },
  imageResolution: { default: 'auto', options: ['auto', '1K', '2K', '4K'] }
})
```

- [ ] **步骤 2：运行测试并确认按预期失败**

运行：

```bash
pnpm exec vitest run --project provider-registry packages/provider-registry/src/__tests__/catalog-invariants.test.ts
```

预期：FAIL；稳定版缺少 `imageGeneration`，预览版缺少 `auto` 默认值。

### 任务 2：最小化补齐模型能力并生成目录

**文件：**
- 修改：`packages/provider-registry/src/creators/google.ts`
- 修改：`packages/provider-registry/data/models.json`

- [ ] **步骤 1：声明稳定版 Nano Banana 2**

在 preview 模型旁新增 `gemini-3-1-flash-image` 手工模型项，沿用上游名称、family、capabilities 与 modalities，并声明：

```ts
aspectRatio: {
  default: 'auto',
  options: [
    'auto', 'ASPECT_1_1', 'ASPECT_1_4', 'ASPECT_1_8', 'ASPECT_2_3', 'ASPECT_3_2',
    'ASPECT_3_4', 'ASPECT_4_1', 'ASPECT_4_3', 'ASPECT_4_5', 'ASPECT_5_4', 'ASPECT_8_1',
    'ASPECT_9_16', 'ASPECT_16_9', 'ASPECT_21_9'
  ],
  render: 'chips',
  type: 'enum'
},
imageResolution: {
  default: 'auto',
  options: ['auto', '1K', '2K', '4K'],
  render: 'chips',
  type: 'enum'
}
```

- [ ] **步骤 2：同步 preview 的智能默认值**

保留 preview 当前显式比例列表，只在两个参数的 `options` 首位加入 `auto` 并将 `default` 设为 `auto`。

- [ ] **步骤 3：生成 catalog**

运行：

```bash
pnpm --filter @cherrystudio/provider-registry generate
```

预期：`packages/provider-registry/data/models.json` 中稳定版与预览版均包含新的 `imageGeneration` 契约；不应出现无关 provider/model 变化。

- [ ] **步骤 4：运行定向测试**

运行：

```bash
pnpm exec vitest run --project provider-registry packages/provider-registry/src/__tests__/catalog-invariants.test.ts
pnpm exec vitest run --project main src/main/ai/provider/custom/wire/__tests__/buildImageRequest.test.ts
```

预期：两条命令全部 PASS；wire 测试继续证明显式 aspect ratio 与 1K/2K/4K 投递到 Google/Vertex `imageConfig`。

### 任务 3：校验并提交

**文件：**
- 检查：本计划列出的全部修改文件。

- [ ] **步骤 1：运行仓库非全量测试校验**

运行 `pnpm format`、`pnpm lint`、`pnpm build:check`。按用户要求不运行全量 `pnpm test`。

- [ ] **步骤 2：审查 diff**

确认只包含 Google Nano Banana 2 registry、对应 catalog 生成结果、测试和文档，无通用兼容层或其他模型改动。

- [ ] **步骤 3：签名提交**

```bash
git add docs/superpowers packages/provider-registry/src/__tests__/catalog-invariants.test.ts packages/provider-registry/src/creators/google.ts packages/provider-registry/data/models.json
git commit -S --signoff -m "fix(provider-registry): restore Gemini image parameters"
git cat-file commit HEAD | rg '^gpgsig '
```

预期：提交成功并包含 `gpgsig` 与 `Signed-off-by`。
