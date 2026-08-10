# Agent 文件夹提及修复实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 修正共享目录 fuzzy 搜索契约，让 Agent Composer 通过单次、有界、可丢弃旧结果的查询返回文件与文件夹，并禁止重复选择已提及的文件夹。

**架构：** 主进程 `listDirectory` 按既有 include flags 分别收集 ripgrep 文件候选和文件系统目录候选，用同一 fuzzy 评分合并排序后应用全局 `maxEntries`。renderer 只负责 200ms debounce、request generation、跨 root 聚合和建议项投影，不缓存或二次过滤完整目录树。

**技术栈：** TypeScript、Electron IPC、React hooks、Tiptap Composer tokens、Vitest 3、Testing Library、Node.js `fs`、ripgrep。

---

## 规格与执行边界

- 设计规格：`docs/superpowers/specs/2026-08-10-agent-folder-mention-fixes-design.md`
- 当前分支：`codex/agent-folder-mention`
- 当前工作区包含用户尚未提交的通用 suggestion 竞态修改：
  - `src/renderer/components/composer/quickPanel/suggestionExtension.ts`
  - `src/renderer/components/composer/__tests__/suggestionExtension.test.ts`
- 上述两个文件不属于本功能。不要恢复、覆盖或暂存它们；每次 commit 都使用精确路径 `git add`。
- 不新增 IPC channel、共享 option 字段、renderer 搜索算法或目录 cache。
- 每个 commit 都必须使用 `git commit -S --signoff`，并检查 `gpgsig` 与 `Signed-off-by`。
- `pnpm build:check` 必须在每个 commit 前成功。最终提交前还要按仓库要求显式运行 `pnpm lint`、`pnpm test`、`pnpm format` 和 `pnpm test:lint`。

## 文件结构

### 修改

- `src/main/services/file/tree/search.ts`
  - 目录专用调用不再依赖 ripgrep。
  - fuzzy 模式同时收集文件与目录，统一评分、排序和裁剪。
- `src/main/services/file/tree/__tests__/search.test.ts`
  - 用真实临时目录锁定 include flags、空目录、fuzzy、深度、隐藏/排除目录、混合排序和 combined cap。
  - 锁定目录专用搜索在 ripgrep 不可用时仍成功。
- `src/preload/preload.ts`
  - 删除本地重复的 `DirectoryListOptions` / `DirectoryEntry`，复用 `@shared/types/file`。
- `src/renderer/components/composer/variants/agent/useAgentResourceMentionSource.tsx`
  - 删除 renderer 目录索引/cache/过滤。
  - 使用一个 combined `listDirectoryEntries` 请求路径、generation 和 partial-failure 聚合。
  - 将已存在 folder token 投影为 disabled item，保留 command 二次防线。
- `src/renderer/components/composer/variants/__tests__/AgentComposer.test.tsx`
  - 更新 combined 查询断言。
  - 增加 debounce、stale result、scope、partial failure 和重复文件夹测试。

### 明确不修改

- `src/shared/types/file/common.ts`：现有 `DirectoryListOptions` 与 `DirectoryEntry` 已足够。
- `src/shared/IpcChannel.ts`、`src/main/ipc.ts`：不新增或改变 channel。
- `src/renderer/components/composer/quickPanel/suggestionExtension.ts`：历史竞态不在本功能范围。
- `src/renderer/components/composer/__tests__/suggestionExtension.test.ts`：保留用户工作区改动，禁止暂存。

## 任务 1：修复共享 fuzzy 目录搜索契约

**文件：**

- 修改：`src/main/services/file/tree/__tests__/search.test.ts:1-209`
- 修改：`src/main/services/file/tree/search.ts:1-545`

- [ ] **步骤 1：扩展测试 import，并为 fuzzy include flags 与空目录添加失败测试**

将动态 import 改为同时取得两个公开函数：

```ts
const { listDirectory, listDirectoryEntries } = await import('../search')
```

在 `listDirectory (search mode, fuzzy + maxEntries)` describe 中增加以下测试。这里继续使用真实临时目录与真实测试 ripgrep，不 mock 搜索结果：

```ts
it('returns fuzzy-matched empty directories when directories are requested without files', async () => {
  await mkdir(path.join(tmp, 'documentation'))
  await mkdir(path.join(tmp, 'other'))
  await writeFile(path.join(tmp, 'documentation-file.md'), 'file')

  const entries = await listDirectoryEntries(tmp as AbsoluteFilePath, {
    recursive: true,
    includeFiles: false,
    includeDirectories: true,
    searchPattern: 'dcmnttn'
  })

  expect(entries).toEqual([
    {
      path: path.join(tmp, 'documentation').replace(/\\/g, '/'),
      isDirectory: true
    }
  ])
})

it('honors file-only fuzzy searches when a matching directory also exists', async () => {
  await mkdir(path.join(tmp, 'notes-folder'))
  await writeFile(path.join(tmp, 'notes-file.md'), 'notes')

  const entries = await listDirectoryEntries(tmp as AbsoluteFilePath, {
    includeFiles: true,
    includeDirectories: false,
    searchPattern: 'notes'
  })

  expect(entries).toHaveLength(1)
  expect(entries[0]).toEqual({
    path: path.join(tmp, 'notes-file.md').replace(/\\/g, '/'),
    isDirectory: false
  })
})

it('merges files and directories before applying maxEntries and prefers a directory on a score tie', async () => {
  await mkdir(path.join(tmp, 'a', 'q'), { recursive: true })
  await mkdir(path.join(tmp, 'b'), { recursive: true })
  await writeFile(path.join(tmp, 'b', 'q'), 'file')

  const entries = await listDirectoryEntries(tmp as AbsoluteFilePath, {
    includeFiles: true,
    includeDirectories: true,
    searchPattern: 'q',
    maxEntries: 2
  })

  expect(entries).toHaveLength(2)
  expect(entries.map((entry) => entry.isDirectory)).toEqual([true, false])
})

it('applies depth, hidden, and excluded-directory rules to fuzzy directory candidates', async () => {
  await mkdir(path.join(tmp, 'visible', 'target'), { recursive: true })
  await mkdir(path.join(tmp, '.hidden', 'target'), { recursive: true })
  await mkdir(path.join(tmp, 'node_modules', 'target'), { recursive: true })
  await mkdir(path.join(tmp, 'deep', 'one', 'target'), { recursive: true })

  const results = await listDirectory(tmp as AbsoluteFilePath, {
    recursive: true,
    maxDepth: 2,
    includeHidden: false,
    includeFiles: false,
    includeDirectories: true,
    searchPattern: 'target'
  })

  expect(results).toEqual([path.join(tmp, 'visible', 'target').replace(/\\/g, '/')])
})
```

- [ ] **步骤 2：增加目录专用搜索不依赖 ripgrep 的失败测试**

在 `listDirectory (error paths)` describe 中，保留现有默认文件搜索报错测试，并在它前面加入：

```ts
it('searches directories when ripgrep is unavailable and files are excluded', async () => {
  await mkdir(path.join(tmp, 'docs-empty'))
  mockExistsSync.mockReturnValue(false)

  const results = await listDirectory(tmp as AbsoluteFilePath, {
    includeFiles: false,
    includeDirectories: true,
    searchPattern: 'docs'
  })

  expect(results).toEqual([path.join(tmp, 'docs-empty').replace(/\\/g, '/')])
})
```

现有测试 `throws "Ripgrep binary not available"...` 不改 options；它继续证明默认 `includeFiles: true` 时缺少 ripgrep 会拒绝。

- [ ] **步骤 3：运行目标测试并确认新契约失败**

运行：

```bash
pnpm exec vitest run --project main src/main/services/file/tree/__tests__/search.test.ts
```

预期：FAIL。至少看到以下旧行为：

- fuzzy directory-only 请求在 `listDirectory` 的无条件 binary check 抛出 `Ripgrep binary not available`；
- fuzzy include-both 请求只返回 ripgrep 文件，不返回目录；
- 空目录 fuzzy 测试得不到 `documentation`。

- [ ] **步骤 4：为 fuzzy 文件与目录建立共同候选模型**

在 `search.ts` 的 scoring helpers 后、main dispatch 前加入以下类型与 helpers；路径全部使用 forward slash，排序先按 score，再目录优先，最后按路径稳定排序：

```ts
interface ScoredSearchEntry {
  path: string
  isDirectory: boolean
  score: number
}

function parseRipgrepPaths(output: string): string[] {
  return output
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => line.replace(/\\/g, '/'))
}

function scoreFuzzyPaths(paths: readonly string[], query: string, isDirectory: boolean): ScoredSearchEntry[] {
  return paths
    .filter((entryPath) => isFuzzyMatch(entryPath, query))
    .map((entryPath) => ({
      path: entryPath,
      isDirectory,
      score: getFuzzyMatchScore(entryPath, query)
    }))
}

function compareScoredSearchEntries(a: ScoredSearchEntry, b: ScoredSearchEntry): number {
  if (a.score !== b.score) return b.score - a.score
  if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
  return a.path.localeCompare(b.path)
}
```

- [ ] **步骤 5：把 fuzzy 文件搜索收敛成返回 scored candidates 的 helper**

保留 `buildRipgrepBaseArgs` 与第一次 glob 预筛选。用以下 helper 替代 fuzzy 分支中的内联 ripgrep 逻辑：

```ts
async function searchFuzzyFiles(resolvedPath: string, options: ResolvedOptions): Promise<ScoredSearchEntry[]> {
  if (!options.includeFiles) return []

  const args = buildRipgrepBaseArgs(options, resolvedPath)
  const globPattern = queryToGlobPattern(options.searchPattern)
  args.splice(args.length - 1, 0, '--iglob', globPattern)

  const firstResult = await executeRipgrep(args)
  if (firstResult.exitCode >= 2) {
    throw new Error(`Ripgrep failed with exit code ${firstResult.exitCode}: ${firstResult.output}`)
  }

  const firstCandidates = scoreFuzzyPaths(parseRipgrepPaths(firstResult.output), options.searchPattern, false)
  if (firstCandidates.length > 0) return firstCandidates

  logger.debug('Fuzzy glob returned no results, scanning all files before JS fuzzy matching')
  const fallbackResult = await executeRipgrep(buildRipgrepBaseArgs(options, resolvedPath))
  if (fallbackResult.exitCode >= 2) {
    throw new Error(`Ripgrep failed with exit code ${fallbackResult.exitCode}: ${fallbackResult.output}`)
  }

  return scoreFuzzyPaths(parseRipgrepPaths(fallbackResult.output), options.searchPattern, false)
}
```

删除 `isGreedySubstringMatch` 与 `getGreedyMatchScore`。fallback 现在只扩大候选集合，匹配和评分仍使用与首轮、目录相同的 fuzzy 规则，避免合并两个不可比较的 score 标尺。

- [ ] **步骤 6：收集所有受约束目录，再用共同 fuzzy 规则评分**

在 `searchFuzzyFiles` 后加入：

```ts
async function searchFuzzyDirectories(
  resolvedPath: string,
  options: ResolvedOptions
): Promise<ScoredSearchEntry[]> {
  if (!options.includeDirectories) return []

  const directories = await searchDirectories(resolvedPath, {
    ...options,
    searchPattern: '.'
  })
  return scoreFuzzyPaths(directories, options.searchPattern, true)
}
```

这里把 `searchPattern` 临时设为 list sentinel，只是为了让受深度、隐藏目录和 `EXCLUDED_DIRS` 约束的遍历返回全部目录候选；renderer 不参与过滤。空目录会自然进入候选集合。

- [ ] **步骤 7：替换 fuzzy dispatch，并让 binary check 遵守 includeFiles**

把 `listDirectoryWithRipgrep` 的 fuzzy 分支替换为：

```ts
if (options.fuzzy && options.searchPattern && options.searchPattern !== '.') {
  const [files, directories] = await Promise.all([
    searchFuzzyFiles(resolvedPath, options),
    searchFuzzyDirectories(resolvedPath, options)
  ])

  return [...files, ...directories]
    .sort(compareScoredSearchEntries)
    .slice(0, options.maxEntries)
    .map((entry) => entry.path)
}
```

在公开 `listDirectory` 中，把无条件 binary check：

```ts
if (!(await resolveRipgrepBinary())) {
  throw new Error('Ripgrep binary not available')
}
```

替换为：

```ts
if (mergedOptions.includeFiles && !(await resolveRipgrepBinary())) {
  throw new Error('Ripgrep binary not available')
}
```

不要改变 list mode 的 `searchByFilename` 排序与默认 unlimited 行为。

- [ ] **步骤 8：运行主进程目标测试并确认通过**

运行：

```bash
pnpm exec vitest run --project main src/main/services/file/tree/__tests__/search.test.ts
```

预期：PASS，且没有 skipped 之外的失败。若本机没有测试 ripgrep，directory-only error-path 测试仍必须执行并通过；ripgrep 集成 describe 会按现有 `skipIf` 跳过。

- [ ] **步骤 9：运行共享消费者相关测试**

运行：

```bash
pnpm exec vitest run --project renderer src/renderer/components/chat/panes/__tests__/ArtifactPane.test.tsx
```

预期：PASS。该测试使用 IPC mock，但会锁定 ArtifactPane 仍按 `includeFiles: true`、`includeDirectories: true` 消费同一契约，没有 renderer API 变化。

- [ ] **步骤 10：执行提交门禁并检查没有扩大工作区范围**

运行：

```bash
pnpm build:check
git diff --check
git status --short
```

预期：`pnpm build:check` exit 0；除本任务两个文件和既有用户工作区文件外没有新增代码改动。格式化器如果重写本任务文件，将格式化结果包含在本任务提交；不要暂存 suggestion 竞态文件。

- [ ] **步骤 11：提交共享搜索修复**

运行：

```bash
git add -- src/main/services/file/tree/search.ts src/main/services/file/tree/__tests__/search.test.ts
git diff --cached --name-only
git diff --cached --check
git commit -S --signoff -m "fix(file-search): honor directory options in fuzzy search"
git cat-file commit HEAD | rg "^gpgsig |^Signed-off-by:"
```

预期：cached name list 只有上述两个文件；commit 成功；最后命令同时匹配 `gpgsig` 和 `Signed-off-by:`。

## 任务 2：改为有界 combined 资源查询并禁用重复文件夹

**文件：**

- 修改：`src/preload/preload.ts:15-42,139-142`
- 修改：`src/renderer/components/composer/variants/__tests__/AgentComposer.test.tsx:12-21,624-664,688-815,2255-2757`
- 修改：`src/renderer/components/composer/variants/agent/useAgentResourceMentionSource.tsx:1-412`

- [ ] **步骤 1：让 Agent Composer 测试可直接驱动资源 hook 与 serializer mock**

更新测试 import：

```ts
import { act, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react'
import * as ComposerDraftModule from '../../composerDraft'
import type { ComposerSurfaceProps } from '../../ComposerSurface'
import { COMPOSER_TOKEN_NODE_NAME } from '../../ComposerTokenNode'
import type { ComposerSerializedToken } from '../../tokens'
import { useAgentResourceMentionSource } from '../agent/useAgentResourceMentionSource'
```

删除原来的 `import type * as ComposerDraftModule`。在现有 `beforeEach` 重置 file mocks 后加入 serializer reset，避免重复文件夹测试污染后续用例：

```ts
vi.mocked(ComposerDraftModule.serializeComposerDocument).mockReset()
vi.mocked(ComposerDraftModule.serializeComposerDocument).mockReturnValue({ text: '', tokens: [] })
```

在 `buildComposerEditorMock` 后加入：

```ts
const createSerializedFolderToken = (folderPath: string): ComposerSerializedToken => ({
  id: `folder:${folderPath}`,
  kind: 'folder',
  label: path.basename(folderPath),
  description: folderPath,
  promptText: folderPath,
  index: 0,
  textOffset: 0
})

const renderResourceMentionHook = (initialAccessiblePaths: readonly string[]) =>
  renderHook(
    ({ accessiblePaths }: { accessiblePaths: readonly string[] }) =>
      useAgentResourceMentionSource({
        accessiblePaths,
        files: mocks.files,
        setFiles: mocks.setFiles,
        enabled: true
      }),
    { initialProps: { accessiblePaths: initialAccessiblePaths } }
  )

const requireResourceMentionSource = (
  sources: ReturnType<typeof useAgentResourceMentionSource>
) => {
  const source = sources[0]
  if (!source) throw new Error('Expected the agent resource mention source')
  return source
}
```

还需要在测试顶部增加 Node path import：

```ts
import path from 'node:path'
```

- [ ] **步骤 2：把现有 workspace 资源测试改成单次 combined 查询断言**

在 `provides workspace file resources...` 中删除 `mocks.listDirectory.mockResolvedValue` 和所有 `listDirectory` 调用断言。空查询必须断言完整 options：

```ts
expect(mocks.listDirectoryEntries).toHaveBeenLastCalledWith('/workspace', {
  recursive: false,
  includeHidden: false,
  includeFiles: true,
  includeDirectories: true,
  maxEntries: 40,
  searchPattern: '.'
})
expect(mocks.listDirectory).not.toHaveBeenCalled()
```

真实查询断言改为：

```ts
expect(mocks.listDirectoryEntries).toHaveBeenLastCalledWith('/workspace', {
  recursive: true,
  maxDepth: 3,
  includeHidden: false,
  includeFiles: true,
  includeDirectories: true,
  maxEntries: 40,
  searchPattern: 'notes'
})
```

mock result继续同时包含 `/workspace/docs` directory 与重复的 `notes.md` file；断言输出同时有 `docs` 与 `docs/notes.md`，并且重复文件只产生一个 item。

- [ ] **步骤 3：重写空文件夹测试，证明不再缓存全量目录索引**

用以下测试替换 `lazily caches searchable empty folders and inserts them as folder tokens`：

```ts
it('queries and inserts an empty folder through the bounded combined resource search', async () => {
  mocks.listDirectoryEntries.mockResolvedValue([
    { path: '/workspace/docs/empty', isDirectory: true }
  ])

  render(
    <AgentComposer
      agentId="agent-1"
      sessionId="session-1"
      sendMessage={mocks.sendMessage}
      stop={mocks.stop}
      isStreaming={false}
    />
  )

  const source = mocks.surfaceProps?.suggestionSources?.[0]
  const items = await source?.items({ query: 'empty', editor: {} as any })
  const folderItem = items?.find((item) => item.label === 'docs/empty')
  if (!folderItem) throw new Error('Expected an empty-folder suggestion item')

  expect(mocks.listDirectory).not.toHaveBeenCalled()
  expect(mocks.listDirectoryEntries).toHaveBeenCalledTimes(1)
  expect(mocks.listDirectoryEntries).toHaveBeenLastCalledWith(
    '/workspace',
    expect.objectContaining({
      recursive: true,
      maxDepth: 3,
      includeFiles: true,
      includeDirectories: true,
      maxEntries: 40,
      searchPattern: 'empty'
    })
  )

  mocks.setFiles.mockClear()
  const { editor, chain } = buildComposerEditorMock()
  folderItem.command?.({ editor, range: { from: 0, to: 0 }, item: folderItem, query: 'empty' })

  expect(chain.insertComposerToken).toHaveBeenCalledWith(
    expect.objectContaining({
      kind: 'folder',
      label: 'empty',
      description: '/workspace/docs/empty',
      promptText: '/workspace/docs/empty'
    })
  )
  expect(mocks.setFiles).not.toHaveBeenCalled()
})
```

- [ ] **步骤 4：增加 debounce、stale result、scope 和 exit 的失败测试**

保留现有 200ms debounce 测试，但将名称中的 `file search` 改为 `resource search`，并补充 `includeDirectories: true`、`maxEntries: 40` 断言。再增加以下三个直接 hook 测试：

```ts
it('drops an in-flight resource result after a newer query completes', async () => {
  vi.useFakeTimers()
  try {
    const first = createDeferred<Array<{ path: string; isDirectory: boolean }>>()
    const latest = createDeferred<Array<{ path: string; isDirectory: boolean }>>()
    mocks.listDirectoryEntries.mockImplementation((_root, options) =>
      options?.searchPattern === 'note' ? first.promise : latest.promise
    )
    const hook = renderResourceMentionHook(['/workspace'])
    const source = requireResourceMentionSource(hook.result.current)

    const firstItems = source.items({ query: 'note', editor: {} as any })
    await vi.advanceTimersByTimeAsync(200)
    const latestItems = source.items({ query: 'notes', editor: {} as any })
    await vi.advanceTimersByTimeAsync(200)

    latest.resolve([{ path: '/workspace/latest-notes.md', isDirectory: false }])
    await expect(latestItems).resolves.toEqual([
      expect.objectContaining({ label: 'latest-notes.md' })
    ])

    first.resolve([{ path: '/workspace/stale-note.md', isDirectory: false }])
    await expect(firstItems).resolves.toEqual([])
  } finally {
    vi.useRealTimers()
  }
})

it('drops an old workspace result after the accessible path scope changes', async () => {
  const oldScope = createDeferred<Array<{ path: string; isDirectory: boolean }>>()
  mocks.listDirectoryEntries
    .mockReturnValueOnce(oldScope.promise)
    .mockResolvedValueOnce([{ path: '/workspace-2/new.md', isDirectory: false }])
  const hook = renderResourceMentionHook(['/workspace'])
  const oldSource = requireResourceMentionSource(hook.result.current)

  const oldItems = oldSource.items({ query: '', editor: {} as any })
  hook.rerender({ accessiblePaths: ['/workspace-2'] })
  const newSource = requireResourceMentionSource(hook.result.current)
  await expect(newSource.items({ query: '', editor: {} as any })).resolves.toEqual([
    expect.objectContaining({ label: 'new.md' })
  ])

  oldScope.resolve([{ path: '/workspace/stale.md', isDirectory: false }])
  await expect(oldItems).resolves.toEqual([])
})

it('cancels a pending debounced query when the panel exits', async () => {
  vi.useFakeTimers()
  try {
    const hook = renderResourceMentionHook(['/workspace'])
    const source = requireResourceMentionSource(hook.result.current)
    const items = source.items({ query: 'notes', editor: {} as any })

    source.onExit?.({} as any)
    await vi.advanceTimersByTimeAsync(200)

    expect(mocks.listDirectoryEntries).not.toHaveBeenCalled()
    await expect(items).resolves.toEqual([])
  } finally {
    vi.useRealTimers()
  }
})
```

- [ ] **步骤 5：增加跨 root partial failure 与 all-failed 测试**

在同一 describe 中加入：

```ts
it('keeps successful roots without an error row when another root fails', async () => {
  mocks.listDirectoryEntries.mockImplementation((rootPath) =>
    rootPath === '/workspace-a'
      ? Promise.resolve([{ path: '/workspace-a/docs', isDirectory: true }])
      : Promise.reject(new Error('offline'))
  )
  const hook = renderResourceMentionHook(['/workspace-a', '/workspace-b'])
  const source = requireResourceMentionSource(hook.result.current)

  const items = await source.items({ query: '', editor: {} as any })

  expect(items).toEqual([expect.objectContaining({ label: 'docs' })])
  expect(items).not.toContainEqual(expect.objectContaining({ id: 'agent-resource:error' }))
})

it('shows the existing resource error item when every accessible root fails', async () => {
  mocks.listDirectoryEntries.mockRejectedValue(new Error('offline'))
  const hook = renderResourceMentionHook(['/workspace-a', '/workspace-b'])
  const source = requireResourceMentionSource(hook.result.current)

  const items = await source.items({ query: '', editor: {} as any })

  expect(items).toEqual([
    expect.objectContaining({
      id: 'agent-resource:error',
      disabled: true
    })
  ])
})
```

- [ ] **步骤 6：增加重复 folder token 的 disabled 与 command 防线测试**

加入两个独立断言，分别锁定面板状态和面板生成后的竞态：

```ts
it('marks an already mentioned folder suggestion as disabled after one document serialization', async () => {
  const folderPath = '/workspace/docs'
  vi.mocked(ComposerDraftModule.serializeComposerDocument).mockReturnValue({
    text: folderPath,
    tokens: [createSerializedFolderToken(folderPath)]
  })
  mocks.listDirectoryEntries.mockResolvedValue([{ path: folderPath, isDirectory: true }])
  const hook = renderResourceMentionHook(['/workspace'])
  const source = requireResourceMentionSource(hook.result.current)

  const items = await source.items({ query: '', editor: {} as any })

  expect(items).toEqual([
    expect.objectContaining({ label: 'docs', disabled: true })
  ])
  expect(ComposerDraftModule.serializeComposerDocument).toHaveBeenCalledTimes(1)
})

it('rechecks the live document before executing a folder command', async () => {
  const folderPath = '/workspace/docs'
  mocks.listDirectoryEntries.mockResolvedValue([{ path: folderPath, isDirectory: true }])
  const hook = renderResourceMentionHook(['/workspace'])
  const source = requireResourceMentionSource(hook.result.current)
  const items = await source.items({ query: '', editor: {} as any })
  const folderItem = items[0]
  if (!folderItem) throw new Error('Expected a folder suggestion item')
  expect(folderItem.disabled).toBe(false)

  vi.mocked(ComposerDraftModule.serializeComposerDocument).mockReturnValue({
    text: folderPath,
    tokens: [createSerializedFolderToken(folderPath)]
  })
  const { editor, chain } = buildComposerEditorMock()
  folderItem.command?.({ editor, range: { from: 0, to: 0 }, item: folderItem, query: '' })

  expect(chain.insertComposerToken).not.toHaveBeenCalled()
})
```

- [ ] **步骤 7：运行 renderer 目标测试并确认旧实现失败**

运行：

```bash
pnpm exec vitest run --project renderer src/renderer/components/composer/variants/__tests__/AgentComposer.test.tsx
```

预期：FAIL。旧实现仍会调用 `listDirectory` 建目录 cache、combined options 不成立、旧 in-flight 结果未统一丢弃、folder item 固定为 `disabled: false`。

- [ ] **步骤 8：在 preload 中复用共享目录类型**

保留以下 shared import：

```ts
import type {
  AbsoluteFilePath,
  CreateInternalEntryIpcParams,
  DirectoryEntry,
  DirectoryListOptions,
  EnsureExternalEntryIpcParams,
  GetPhysicalPathIpcParams
} from '@shared/types/file'
```

删除 preload 内本地声明的两个重复 type。运行时 bridge 保持：

```ts
listDirectory: (dirPath: string, options?: DirectoryListOptions) =>
  ipcRenderer.invoke(IpcChannel.File_ListDirectory, dirPath, options),
listDirectoryEntries: (dirPath: string, options?: DirectoryListOptions): Promise<DirectoryEntry[]> =>
  ipcRenderer.invoke(IpcChannel.File_ListDirectoryEntries, dirPath, options),
```

- [ ] **步骤 9：删除 renderer 目录索引与二次 fuzzy 过滤**

在 `useAgentResourceMentionSource.tsx`：

1. 删除 `defaultFilterFn`、`defaultSortFn`、`QuickPanelListItem` import。
2. 删除 `DirectoryListingMode`、`DirectoryListingResult`、`DirectorySuggestionItem`。
3. 删除 `createFuzzyRegex`、`filterDirectoryItems`、`listWorkspaceDirectories`。
4. 删除 `directoryListingCacheRef`、`directoryListingGenerationRef`、`directoryListingScopeKeyRef`。
5. 用以下常量和 pending 类型替换文件/目录分离常量：

```ts
const EMPTY_QUERY_RESOURCE_LIMIT = 5
const RESOURCE_SEARCH_MAX_DEPTH = 3
const RESOURCE_RESULT_LIMIT = 40
const RESOURCE_SEARCH_DEBOUNCE_MS = 200

type ResourceSearchResult = PromiseSettledResult<DirectoryEntry[]>[] | null

interface PendingResourceSearch {
  resolve: (results: ResourceSearchResult) => void
  timerId: number
}
```

`null` 明确表示该 generation 已失效；合法的空 root 结果仍然是 `[]`。

- [ ] **步骤 10：实现统一 generation、debounce 和 combined IPC 调用**

在 hook 内、`resourceMentionStateRef.current` 赋值后加入：

```ts
const pendingResourceSearchRef = useRef<PendingResourceSearch | undefined>(undefined)
const resourceSearchGenerationRef = useRef(0)

const invalidateResourceSearch = useCallback(() => {
  resourceSearchGenerationRef.current += 1
  const pending = pendingResourceSearchRef.current
  if (pending) {
    window.clearTimeout(pending.timerId)
    pendingResourceSearchRef.current = undefined
    pending.resolve(null)
  }
  return resourceSearchGenerationRef.current
}, [])

const queryWorkspaceResources = useCallback(
  (searchPaths: readonly string[], normalizedQuery: string): Promise<ResourceSearchResult> => {
    const requestGeneration = invalidateResourceSearch()
    const options = normalizedQuery
      ? {
          recursive: true,
          maxDepth: RESOURCE_SEARCH_MAX_DEPTH,
          includeHidden: false,
          includeFiles: true,
          includeDirectories: true,
          maxEntries: RESOURCE_RESULT_LIMIT,
          searchPattern: normalizedQuery
        }
      : {
          recursive: false,
          includeHidden: false,
          includeFiles: true,
          includeDirectories: true,
          maxEntries: RESOURCE_RESULT_LIMIT,
          searchPattern: '.'
        }

    const execute = async (): Promise<ResourceSearchResult> => {
      const results = await Promise.allSettled(
        searchPaths.map((dirPath) => window.api.file.listDirectoryEntries(dirPath, options))
      )
      return requestGeneration === resourceSearchGenerationRef.current ? results : null
    }

    if (!normalizedQuery) return execute()

    return new Promise<ResourceSearchResult>((resolve) => {
      const pendingSearch: PendingResourceSearch = {
        resolve,
        timerId: window.setTimeout(() => {
          if (pendingResourceSearchRef.current === pendingSearch) {
            pendingResourceSearchRef.current = undefined
          }
          void execute().then(resolve)
        }, RESOURCE_SEARCH_DEBOUNCE_MS)
      }
      pendingResourceSearchRef.current = pendingSearch
    })
  },
  [invalidateResourceSearch]
)

useEffect(() => {
  return () => {
    invalidateResourceSearch()
  }
}, [accessiblePathsKey, invalidateResourceSearch])
```

`accessiblePathsKey` 变化时 effect cleanup 使旧 scope generation 失效；组件卸载使用同一清理。source 的 `onExit` 只调用 `invalidateResourceSearch()`。

- [ ] **步骤 11：聚合 DirectoryEntry、处理 partial failure，并一次计算 folder disabled set**

在 `items` 中保留 additional-items 错误隔离。将现有文件/目录双请求和 cache 逻辑替换为以下结构：

```ts
const searchResults = await queryWorkspaceResources(accessiblePaths, normalizedQuery)
if (searchResults === null || accessiblePathsKey !== resourceMentionStateRef.current.accessiblePathsKey) {
  return []
}

const collectedEntries = new Map<AbsoluteFilePath, DirectoryEntry>()
for (const result of searchResults) {
  if (result.status !== 'fulfilled') continue
  for (const entry of result.value) {
    const normalizedPath = AbsoluteFilePathSchema.parse(entry.path.replace(/\\/g, '/'))
    collectedEntries.set(normalizedPath, {
      path: normalizedPath,
      isDirectory: entry.isDirectory
    })
  }
}

const allRootsFailed = searchResults.length > 0 && searchResults.every((result) => result.status === 'rejected')
if (collectedEntries.size === 0 && allRootsFailed) {
  resourceItems.push({
    id: 'agent-resource:error',
    label: t('common.error'),
    description: t('chat.input.resource_panel.no_file_found.description'),
    icon: <Folder size={16} />,
    disabled: true,
    command: () => undefined
  })
} else {
  const mentionedFolderPromptTexts = new Set(
    serializeComposerDocument(editor).tokens
      .filter((token) => token.kind === 'folder')
      .map((token) => token.promptText)
      .filter((promptText): promptText is string => Boolean(promptText))
  )

  for (const entry of collectedEntries.values()) {
    const entryPath = entry.path
    const relativePath = getAccessiblePathRelativePath(entryPath, accessiblePaths)

    if (entry.isDirectory) {
      resourceItems.push({
        id: createAgentResourceItemId(entryPath),
        label: relativePath,
        description: entryPath,
        icon: <Folder size={16} />,
        filterText: `${relativePath} ${entryPath}`,
        disabled: mentionedFolderPromptTexts.has(entryPath),
        command: ({ editor }) => {
          const exists = serializeComposerDocument(editor).tokens.some(
            (token) => token.kind === 'folder' && token.promptText === entryPath
          )
          if (!exists) {
            editor
              .chain()
              .focus()
              .insertComposerToken(createComposerFolderToken(entryPath))
              .insertContent(' ')
              .run()
          }
        }
      })
      continue
    }

    const file = files.find((currentFile) => currentFile.path === entryPath)
    const tokenFile = file ?? createAttachmentFromPath(entryPath)
    const token = agentFileToComposerToken(tokenFile)
    const isSelectedFile = (currentFile: ComposerAttachment) =>
      currentFile.path === entryPath || agentComposerTokenId.file(currentFile) === token.id

    resourceItems.push({
      id: createAgentResourceItemId(entryPath),
      label: relativePath,
      description: entryPath,
      icon: <File size={16} />,
      filterText: `${relativePath} ${entryPath}`,
      disabled: files.some(isSelectedFile),
      command: ({ editor }) => {
        const exists = serializeComposerDocument(editor).tokens.some((currentToken) => currentToken.id === token.id)
        if (!exists) {
          editor.chain().focus().insertComposerToken(token).insertContent(' ').run()
        }
        setFiles((prevFiles) => (prevFiles.some(isSelectedFile) ? prevFiles : [...prevFiles, tokenFile]))
      }
    })
  }
}
```

删除旧的 `collectedFiles.slice(0, 50)` 和 `filterDirectoryItems` 调用。主进程已经按每个 root 在 IPC 前裁剪到 40；renderer 只去重并保持 root/主进程顺序。

更新 hook 注释为：空查询读取根级 combined entries，真实查询由主进程 fuzzy 搜索；不要再声称“目录索引被缓存后在 renderer 过滤”。source memo dependencies 应为：

```ts
[invalidateResourceSearch, queryWorkspaceResources, t]
```

- [ ] **步骤 12：运行 Agent Composer 目标测试并确认通过**

运行：

```bash
pnpm exec vitest run --project renderer src/renderer/components/composer/variants/__tests__/AgentComposer.test.tsx
```

预期：PASS。重点确认 debounce 测试使用 fake timers 后不会泄漏 timer；serializer mock 在每个测试前恢复为空 draft。

- [ ] **步骤 13：运行 Composer 与 ArtifactPane 邻近回归测试**

运行：

```bash
pnpm exec vitest run --project renderer \
  src/renderer/components/composer/variants/__tests__/AgentComposer.test.tsx \
  src/renderer/components/composer/__tests__/ComposerSurface.test.tsx \
  src/renderer/components/composer/__tests__/ComposerToken.test.tsx \
  src/renderer/components/chat/panes/__tests__/ArtifactPane.test.tsx
```

预期：四个测试文件全部 PASS。不要把 `suggestionExtension.test.ts` 纳入此功能的目标测试或提交；它属于工作区中的独立竞态尝试。

- [ ] **步骤 14：执行完整仓库验证**

按顺序运行：

```bash
pnpm lint
pnpm test
pnpm format
pnpm build:check
pnpm test:lint
git diff --check
```

预期：所有命令 exit 0。`pnpm lint`、`pnpm format` 与 `pnpm build:check` 会写文件；每个命令后如有变更，使用 `git diff -- <本任务三个文件>` 审核并保留与本任务直接相关的格式化结果。不得暂存或清理两个 suggestion 竞态文件。

- [ ] **步骤 15：检查最终提交范围**

运行：

```bash
git status --short
git diff -- src/preload/preload.ts \
  src/renderer/components/composer/variants/agent/useAgentResourceMentionSource.tsx \
  src/renderer/components/composer/variants/__tests__/AgentComposer.test.tsx
```

预期：本任务 diff 只包含共享类型复用、combined resource query、generation/debounce、partial failure、folder disabled 和对应测试。两个 suggestion 文件仍作为未暂存用户改动存在。

- [ ] **步骤 16：提交 Agent Composer 修复**

运行：

```bash
git add -- src/preload/preload.ts \
  src/renderer/components/composer/variants/agent/useAgentResourceMentionSource.tsx \
  src/renderer/components/composer/variants/__tests__/AgentComposer.test.tsx
git diff --cached --name-only
git diff --cached --check
git commit -S --signoff -m "fix(agent-composer): bound workspace resource mentions"
git cat-file commit HEAD | rg "^gpgsig |^Signed-off-by:"
```

预期：cached name list 只有上述三个文件；commit 成功；签名与 DCO 均存在。

## 任务 3：最终审计与交接

**文件：**

- 不修改功能文件；只读审计 commit、状态和 diff。

- [ ] **步骤 1：确认两个功能提交线性且范围正确**

运行：

```bash
git log --oneline --decorate -4
git show --stat --oneline HEAD~1
git show --stat --oneline HEAD
```

预期：最近两个功能提交依次为：

1. `fix(file-search): honor directory options in fuzzy search`
2. `fix(agent-composer): bound workspace resource mentions`

第一个只有 main search 与其测试；第二个只有 preload、Agent resource hook 与 Agent Composer 测试。

- [ ] **步骤 2：确认未吞并独立 suggestion 竞态修改**

运行：

```bash
git status --short
git diff --name-only
git diff --cached --name-only
```

预期：cached diff 为空；未提交改动仍只包含：

```text
src/renderer/components/composer/__tests__/suggestionExtension.test.ts
src/renderer/components/composer/quickPanel/suggestionExtension.ts
```

如果出现其他文件，先用只读 `git diff -- <path>` 判断来源；不要 reset、checkout 或删除用户改动。

- [ ] **步骤 3：记录验证证据用于最终交接**

最终回复必须列出：

- 两个 commit hash 与主题；
- main search 目标测试结果；
- Agent Composer/Composer/ArtifactPane 目标测试结果；
- `pnpm lint`、`pnpm test`、`pnpm format`、`pnpm build:check`、`pnpm test:lint` 的成功状态；
- 两个未提交 suggestion 文件仍被保留且未纳入功能提交；
- 未 push、未创建 PR，除非用户另行授权。
