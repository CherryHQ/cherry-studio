# CodeTools V2 Migration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate `CodeToolsService` to the v2 lifecycle system and `useCodeTools` hook from Redux to `usePreference`.

**Architecture:** `CodeToolsService` becomes a lifecycle-managed `BaseService` (registered in `serviceRegistry.ts`, accessed via `application.get()`). The `useCodeTools` hook switches from Redux dispatch/selector to `usePreference('feature.code_cli.overrides')`, reading/writing per-tool config via the layered preset pattern. The existing preset (`packages/shared/data/presets/code-cli.ts`) and preference schema (`feature.code_cli.overrides`) are already in place.

**Tech Stack:** Electron lifecycle system (`BaseService`, `@Injectable`, `@ServicePhase`), `usePreference` hook, `CodeCliOverrides` type, Vitest.

**Key design decision — `selectedModel` type change:** Redux stored full `Model` objects per tool. V2 stores composite ID strings (`providerId::modelId`) matching the migration transform in `CodeCliTransforms.ts`. The hook's `selectedModel` return type changes from `Model | null` to `string | null` (the composite ID). `setModel` changes accordingly. `CodeToolsPage.tsx` will need minimal adaptation (not in scope of this plan but noted as follow-up).

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Rename | `src/main/services/CodeToolsService.ts` → `src/main/services/CodeToolsService.v2.ts` | git mv rename for v2 tracking |
| Modify | `src/main/services/CodeToolsService.v2.ts` | Extend `BaseService`, add decorators, lifecycle hooks |
| Modify | `src/main/core/application/serviceRegistry.ts` | Register `CodeToolsService` |
| Modify | `src/main/ipc.ts` | Use `application.get('CodeToolsService')` |
| Rewrite | `src/renderer/src/hooks/useCodeTools.ts` | Replace Redux with `usePreference` |
| Create | `src/main/services/__tests__/CodeToolsService.test.ts` | Lifecycle tests |
| Create | `src/renderer/src/hooks/__tests__/useCodeTools.test.ts` | Hook tests |
| Modify | `src/renderer/src/pages/code/__tests__/index.test.ts` | Update mock for new hook API |

---

### Task 1: Rename CodeToolsService via git mv

**Files:**
- Rename: `src/main/services/CodeToolsService.ts` → `src/main/services/CodeToolsService.v2.ts`

- [ ] **Step 1: git mv**

```bash
cd /Users/suyao/conductor/workspaces/cherry-studio-v4/surat
git mv src/main/services/CodeToolsService.ts src/main/services/CodeToolsService.v2.ts
```

- [ ] **Step 2: Update import in ipc.ts**

In `src/main/ipc.ts`, change:
```typescript
// Before (line 50)
import { codeToolsService } from './services/CodeToolsService'
// After
import { codeToolsService } from './services/CodeToolsService.v2'
```

- [ ] **Step 3: Verify build**

```bash
pnpm typecheck
```
Expected: PASS (no broken imports)

- [ ] **Step 4: Commit**

```bash
git add -A
git commit --signoff -m "refactor: rename CodeToolsService to CodeToolsService.v2"
```

---

### Task 2: Write failing tests for CodeToolsService lifecycle

**Files:**
- Create: `src/main/services/__tests__/CodeToolsService.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// src/main/services/__tests__/CodeToolsService.test.ts
import { BaseService } from '@main/core/lifecycle'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock dependencies
vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn()
    })
  }
}))

vi.mock('@main/constant', () => ({
  isMac: true,
  isWin: false
}))

vi.mock('@main/utils', () => ({
  removeEnvProxy: vi.fn()
}))

vi.mock('@main/utils/ipService', () => ({
  isUserInChina: vi.fn().mockResolvedValue(false)
}))

vi.mock('@main/utils/process', () => ({
  getBinaryName: vi.fn().mockResolvedValue('bun')
}))

vi.mock('child_process', () => ({
  spawn: vi.fn(),
  exec: vi.fn()
}))

vi.mock('util', () => ({
  promisify: vi.fn().mockReturnValue(vi.fn().mockResolvedValue({ stdout: '' }))
}))

vi.mock('semver', () => ({
  default: { coerce: vi.fn(), gte: vi.fn().mockReturnValue(false) }
}))

vi.mock('node:fs', () => ({
  default: {
    existsSync: vi.fn().mockReturnValue(false),
    readFileSync: vi.fn().mockReturnValue(''),
    writeFileSync: vi.fn(),
    unlinkSync: vi.fn(),
    mkdirSync: vi.fn(),
    chmodSync: vi.fn()
  },
  existsSync: vi.fn().mockReturnValue(false),
  readFileSync: vi.fn().mockReturnValue(''),
  writeFileSync: vi.fn(),
  unlinkSync: vi.fn(),
  mkdirSync: vi.fn(),
  chmodSync: vi.fn()
}))

describe('CodeToolsService', () => {
  beforeEach(() => {
    BaseService.resetInstances()
    vi.clearAllMocks()
  })

  it('should extend BaseService', async () => {
    const { CodeToolsService } = await import('../CodeToolsService.v2')
    const instance = new CodeToolsService()
    expect(instance).toBeInstanceOf(BaseService)
  })

  it('should have onInit that preloads terminals', async () => {
    const { CodeToolsService } = await import('../CodeToolsService.v2')
    const instance = new CodeToolsService()
    // onInit is protected, test via _doInit which calls onInit
    await expect(instance._doInit()).resolves.toBeUndefined()
    expect(instance.isReady).toBe(true)
  })

  it('should clean up timers on stop', async () => {
    const { CodeToolsService } = await import('../CodeToolsService.v2')
    const instance = new CodeToolsService()
    await instance._doInit()
    await expect(instance._doStop()).resolves.toBeUndefined()
    expect(instance.isStopped).toBe(true)
  })

  it('should prevent double instantiation', async () => {
    const { CodeToolsService } = await import('../CodeToolsService.v2')
    new CodeToolsService()
    expect(() => new CodeToolsService()).toThrow(/already been instantiated/)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm test:main -- --run src/main/services/__tests__/CodeToolsService.test.ts
```
Expected: FAIL — `CodeToolsService` does not extend `BaseService` yet.

---

### Task 3: Migrate CodeToolsService to lifecycle BaseService

**Files:**
- Modify: `src/main/services/CodeToolsService.v2.ts`

- [ ] **Step 1: Add imports and decorators**

At the top of the file, add lifecycle imports and decorate the class:

```typescript
// Add these imports (at top, with existing imports)
import { BaseService, Injectable, ServicePhase, Phase } from '@main/core/lifecycle'
```

Replace the class declaration:
```typescript
// Before
class CodeToolsService {
// After
@Injectable()
@ServicePhase(Phase.WhenReady)
export class CodeToolsService extends BaseService {
```

- [ ] **Step 2: Convert constructor to onInit**

Move terminal preloading from constructor to `onInit`. Remove manual `bind` calls (class methods accessed via `application.get()` don't need binding for IPC since the handler wrappers in ipc.ts use arrow functions or explicit calls).

Replace the constructor:
```typescript
// Before
constructor() {
  this.getBunPath = this.getBunPath.bind(this)
  this.getPackageName = this.getPackageName.bind(this)
  this.getCliExecutableName = this.getCliExecutableName.bind(this)
  this.isPackageInstalled = this.isPackageInstalled.bind(this)
  this.getVersionInfo = this.getVersionInfo.bind(this)
  this.updatePackage = this.updatePackage.bind(this)
  this.run = this.run.bind(this)

  if (isMac || isWin) {
    this.preloadTerminals()
  }
}

// After
protected async onInit(): Promise<void> {
  if (isMac || isWin) {
    await this.preloadTerminals()
  }
}
```

- [ ] **Step 3: Add onStop for cleanup**

Add cleanup method to clear timers and pending bat file cleanups:

```typescript
protected async onStop(): Promise<void> {
  // Clear all pending opencode config cleanup timers
  for (const [configPath, timer] of this.openCodeCleanupTimers) {
    clearTimeout(timer)
    logger.info(`Cleared cleanup timer for: ${configPath}`)
  }
  this.openCodeCleanupTimers.clear()
  this.openCodeConfigBackups.clear()

  // Clear caches
  this.versionCache.clear()
  this.terminalsCache = null
  this.customTerminalPaths.clear()
}
```

- [ ] **Step 4: Remove the singleton export**

At the bottom of the file, remove:
```typescript
// Remove this line
export const codeToolsService = new CodeToolsService()
```

The class is already exported via `export class CodeToolsService`.

- [ ] **Step 5: Bind `run` method**

The `run` method is passed directly as `ipcMain.handle(IpcChannel.CodeTools_Run, codeToolsService.run)` in ipc.ts. Since it accesses `this`, it must be bound. Instead of constructor binding, use a class field arrow function or bind in ipc.ts. The simplest fix: in `ipc.ts`, we'll wrap it. But first, check if any other methods need `this` binding when called from ipc.ts.

Looking at ipc.ts usage:
- `codeToolsService.run` — passed directly, needs `this` → wrap in arrow in ipc.ts
- Others are called inline with `codeToolsService.method()` → fine

No changes needed in the service file for this. The ipc.ts change handles it (Task 5).

- [ ] **Step 6: Run tests**

```bash
pnpm test:main -- --run src/main/services/__tests__/CodeToolsService.test.ts
```
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/main/services/CodeToolsService.v2.ts src/main/services/__tests__/CodeToolsService.test.ts
git commit --signoff -m "feat: migrate CodeToolsService to v2 lifecycle BaseService"
```

---

### Task 4: Register CodeToolsService in serviceRegistry

**Files:**
- Modify: `src/main/core/application/serviceRegistry.ts`

- [ ] **Step 1: Add import and register**

Add the import at the top of `src/main/core/application/serviceRegistry.ts`:
```typescript
import { CodeToolsService } from '@main/services/CodeToolsService.v2'
```

Add the entry to the `services` object:
```typescript
// Before
export const services = {} as const
// After
export const services = {
  CodeToolsService,
} as const
```

Keep all existing code (`ServiceRegistry` type, `serviceList` export) unchanged.

- [ ] **Step 2: Verify typecheck**

```bash
pnpm typecheck
```
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/main/core/application/serviceRegistry.ts
git commit --signoff -m "feat: register CodeToolsService in service registry"
```

---

### Task 5: Update ipc.ts to use lifecycle container

**Files:**
- Modify: `src/main/ipc.ts`

- [ ] **Step 1: Replace import and usage**

Remove the old import:
```typescript
// Remove
import { codeToolsService } from './services/CodeToolsService.v2'
```

Add application import (if not already present):
```typescript
import { application } from '@main/core/application'
```

Replace the IPC handler registrations (around line 988-999):
```typescript
// CodeTools
const codeToolsService = application.get('CodeToolsService')
ipcMain.handle(IpcChannel.CodeTools_Run, (...args) => codeToolsService.run(...args))
ipcMain.handle(IpcChannel.CodeTools_GetAvailableTerminals, () => codeToolsService.getAvailableTerminalsForPlatform())
ipcMain.handle(IpcChannel.CodeTools_SetCustomTerminalPath, (_, terminalId: string, path: string) =>
  codeToolsService.setCustomTerminalPath(terminalId, path)
)
ipcMain.handle(IpcChannel.CodeTools_GetCustomTerminalPath, (_, terminalId: string) =>
  codeToolsService.getCustomTerminalPath(terminalId)
)
ipcMain.handle(IpcChannel.CodeTools_RemoveCustomTerminalPath, (_, terminalId: string) =>
  codeToolsService.removeCustomTerminalPath(terminalId)
)
```

Note: `run` is wrapped in an arrow function `(...args) => codeToolsService.run(...args)` to preserve `this` context.

- [ ] **Step 2: Verify typecheck**

```bash
pnpm typecheck
```
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/main/ipc.ts
git commit --signoff -m "refactor: use lifecycle container for CodeToolsService in IPC"
```

---

### Task 6: Write failing tests for useCodeTools hook

**Files:**
- Create: `src/renderer/src/hooks/__tests__/useCodeTools.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// src/renderer/src/hooks/__tests__/useCodeTools.test.ts
import { act, renderHook } from '@testing-library/react'
import { codeCLI, terminalApps } from '@shared/config/constant'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock usePreference
const mockSetOverrides = vi.fn().mockResolvedValue(undefined)
let mockOverrides: Record<string, any> = {}

vi.mock('@renderer/data/hooks/usePreference', () => ({
  usePreference: vi.fn(() => [mockOverrides, mockSetOverrides])
}))

vi.mock('@renderer/services/LoggerService', () => ({
  loggerService: {
    withContext: () => ({
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn()
    })
  }
}))

vi.mock('@shared/data/presets/code-cli', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@shared/data/presets/code-cli')>()
  return actual
})

describe('useCodeTools', () => {
  beforeEach(() => {
    mockOverrides = {}
    mockSetOverrides.mockClear()
  })

  it('should return default selectedCliTool when no tool is enabled', async () => {
    const { useCodeTools } = await import('../../hooks/useCodeTools')
    const { result } = renderHook(() => useCodeTools())
    // Default: first CLI tool (qwen-code)
    expect(result.current.selectedCliTool).toBe(codeCLI.qwenCode)
  })

  it('should return the enabled tool as selectedCliTool', async () => {
    mockOverrides = { 'claude-code': { enabled: true } }
    const { useCodeTools } = await import('../../hooks/useCodeTools')
    const { result } = renderHook(() => useCodeTools())
    expect(result.current.selectedCliTool).toBe(codeCLI.claudeCode)
  })

  it('should return per-tool modelId', async () => {
    mockOverrides = {
      'claude-code': { enabled: true, modelId: 'anthropic::claude-3-opus' }
    }
    const { useCodeTools } = await import('../../hooks/useCodeTools')
    const { result } = renderHook(() => useCodeTools())
    expect(result.current.selectedModel).toBe('anthropic::claude-3-opus')
  })

  it('should return default terminal when none set', async () => {
    const { useCodeTools } = await import('../../hooks/useCodeTools')
    const { result } = renderHook(() => useCodeTools())
    expect(result.current.selectedTerminal).toBe(terminalApps.systemDefault)
  })

  it('should update overrides when setCliTool is called', async () => {
    mockOverrides = { 'qwen-code': { enabled: true } }
    const { useCodeTools } = await import('../../hooks/useCodeTools')
    const { result } = renderHook(() => useCodeTools())

    await act(async () => {
      await result.current.setCliTool(codeCLI.claudeCode)
    })

    expect(mockSetOverrides).toHaveBeenCalledWith(
      expect.objectContaining({
        'qwen-code': expect.objectContaining({ enabled: false }),
        'claude-code': expect.objectContaining({ enabled: true })
      })
    )
  })

  it('should update modelId for current tool when setModel is called', async () => {
    mockOverrides = { 'qwen-code': { enabled: true } }
    const { useCodeTools } = await import('../../hooks/useCodeTools')
    const { result } = renderHook(() => useCodeTools())

    await act(async () => {
      await result.current.setModel('openai::gpt-4')
    })

    expect(mockSetOverrides).toHaveBeenCalledWith(
      expect.objectContaining({
        'qwen-code': expect.objectContaining({ modelId: 'openai::gpt-4' })
      })
    )
  })

  it('canLaunch should be true when tool, directory, and model are set', async () => {
    mockOverrides = {
      'qwen-code': {
        enabled: true,
        modelId: 'openai::gpt-4',
        currentDirectory: '/tmp/project'
      }
    }
    const { useCodeTools } = await import('../../hooks/useCodeTools')
    const { result } = renderHook(() => useCodeTools())
    expect(result.current.canLaunch).toBe(true)
  })

  it('canLaunch should be true for github-copilot-cli without model', async () => {
    mockOverrides = {
      'github-copilot-cli': {
        enabled: true,
        currentDirectory: '/tmp/project'
      }
    }
    const { useCodeTools } = await import('../../hooks/useCodeTools')
    const { result } = renderHook(() => useCodeTools())
    expect(result.current.canLaunch).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm test:renderer -- --run src/renderer/src/hooks/__tests__/useCodeTools.test.ts
```
Expected: FAIL — hook still uses Redux.

---

### Task 7: Rewrite useCodeTools hook with usePreference

**Files:**
- Rewrite: `src/renderer/src/hooks/useCodeTools.ts`

- [ ] **Step 1: Implement the new hook**

```typescript
// src/renderer/src/hooks/useCodeTools.ts
import { usePreference } from '@renderer/data/hooks/usePreference'
import { loggerService } from '@renderer/services/LoggerService'
import { codeCLI, terminalApps } from '@shared/config/constant'
import { CODE_CLI_PRESET_MAP } from '@shared/data/presets/code-cli'
import type { CodeCliId, CodeCliOverride, CodeCliOverrides } from '@shared/data/preference/preferenceTypes'
import { useCallback, useMemo } from 'react'

const logger = loggerService.withContext('useCodeTools')

const DEFAULT_TOOL = codeCLI.qwenCode as CodeCliId

/**
 * Get the effective config for a tool by merging preset defaults with overrides
 */
function getEffectiveToolConfig(toolId: CodeCliId, overrides: CodeCliOverrides): Required<CodeCliOverride> {
  const preset = CODE_CLI_PRESET_MAP[toolId]
  const override = overrides[toolId] ?? {}
  return {
    enabled: override.enabled ?? preset.enabled,
    modelId: override.modelId ?? preset.modelId,
    envVars: override.envVars ?? preset.envVars,
    terminal: override.terminal ?? preset.terminal,
    currentDirectory: override.currentDirectory ?? preset.currentDirectory,
    directories: override.directories ?? preset.directories
  }
}

export const useCodeTools = () => {
  const [overrides, setOverrides] = usePreference('feature.code_cli.overrides')

  // Find the currently enabled tool, or default
  const selectedCliTool = useMemo(() => {
    for (const [toolId, override] of Object.entries(overrides)) {
      if (override?.enabled) {
        return toolId as codeCLI
      }
    }
    return DEFAULT_TOOL as codeCLI
  }, [overrides])

  // Get effective config for the selected tool
  const currentConfig = useMemo(
    () => getEffectiveToolConfig(selectedCliTool as CodeCliId, overrides),
    [selectedCliTool, overrides]
  )

  const selectedModel = currentConfig.modelId
  const selectedTerminal = currentConfig.terminal
  const environmentVariables = currentConfig.envVars
  const directories = currentConfig.directories
  const currentDirectory = currentConfig.currentDirectory

  const canLaunch = Boolean(
    selectedCliTool &&
      currentDirectory &&
      (selectedCliTool === codeCLI.githubCopilotCli || selectedModel)
  )

  // Update a field for the current tool
  const updateCurrentTool = useCallback(
    async (patch: Partial<CodeCliOverride>) => {
      const toolId = selectedCliTool as CodeCliId
      const existing = overrides[toolId] ?? {}
      await setOverrides({
        ...overrides,
        [toolId]: { ...existing, ...patch }
      })
    },
    [overrides, setOverrides, selectedCliTool]
  )

  const setCliTool = useCallback(
    async (tool: codeCLI) => {
      const newOverrides = { ...overrides }
      // Disable current tool
      const currentId = selectedCliTool as CodeCliId
      if (newOverrides[currentId]) {
        newOverrides[currentId] = { ...newOverrides[currentId], enabled: false }
      }
      // Enable new tool
      const newId = tool as CodeCliId
      newOverrides[newId] = { ...(newOverrides[newId] ?? {}), enabled: true }
      await setOverrides(newOverrides)
    },
    [overrides, setOverrides, selectedCliTool]
  )

  const setModel = useCallback(
    async (modelId: string | null) => {
      await updateCurrentTool({ modelId })
    },
    [updateCurrentTool]
  )

  const setTerminal = useCallback(
    async (terminal: string) => {
      await updateCurrentTool({ terminal })
    },
    [updateCurrentTool]
  )

  const setEnvVars = useCallback(
    async (envVars: string) => {
      await updateCurrentTool({ envVars })
    },
    [updateCurrentTool]
  )

  const setCurrentDir = useCallback(
    async (directory: string) => {
      // Also add to directories list (MRU behavior)
      const toolId = selectedCliTool as CodeCliId
      const existing = overrides[toolId] ?? {}
      const currentDirs = existing.directories ?? []
      let newDirs: string[]
      if (directory && !currentDirs.includes(directory)) {
        newDirs = [directory, ...currentDirs].slice(0, 10) // MAX_DIRECTORIES = 10
      } else if (directory && currentDirs.includes(directory)) {
        newDirs = [directory, ...currentDirs.filter((d) => d !== directory)]
      } else {
        newDirs = currentDirs
      }
      await setOverrides({
        ...overrides,
        [toolId]: { ...existing, currentDirectory: directory, directories: newDirs }
      })
    },
    [overrides, setOverrides, selectedCliTool]
  )

  const removeDir = useCallback(
    async (directory: string) => {
      const toolId = selectedCliTool as CodeCliId
      const existing = overrides[toolId] ?? {}
      const currentDirs = existing.directories ?? []
      const newDirs = currentDirs.filter((d) => d !== directory)
      const patch: Partial<CodeCliOverride> = { directories: newDirs }
      if (existing.currentDirectory === directory) {
        patch.currentDirectory = ''
      }
      await setOverrides({
        ...overrides,
        [toolId]: { ...existing, ...patch }
      })
    },
    [overrides, setOverrides, selectedCliTool]
  )

  const clearDirs = useCallback(async () => {
    await updateCurrentTool({ directories: [], currentDirectory: '' })
  }, [updateCurrentTool])

  const resetSettings = useCallback(async () => {
    await setOverrides({})
  }, [setOverrides])

  const selectFolder = useCallback(async () => {
    try {
      const folderPath = await window.api.file.selectFolder()
      if (folderPath) {
        await setCurrentDir(folderPath)
        return folderPath
      }
      return null
    } catch (error) {
      logger.error('Failed to select folder:', error as Error)
      throw error
    }
  }, [setCurrentDir])

  return {
    selectedCliTool,
    selectedModel,
    selectedTerminal,
    environmentVariables,
    directories,
    currentDirectory,
    canLaunch,

    setCliTool,
    setModel,
    setTerminal,
    setEnvVars,
    setCurrentDir,
    removeDir,
    clearDirs,
    resetSettings,
    selectFolder
  }
}
```

**Key API changes from v1:**
- `setModel(model: Model | null)` → `setModel(modelId: string | null)` — stores composite ID instead of full Model
- `selectedModel: Model | null` → `selectedModel: string | null` — returns composite ID
- All setters are now async (return `Promise<void>`)
- Data is per-tool (directories, envVars, terminal are scoped to the selected tool)

- [ ] **Step 2: Run hook tests**

```bash
pnpm test:renderer -- --run src/renderer/src/hooks/__tests__/useCodeTools.test.ts
```
Expected: PASS

- [ ] **Step 3: Update page test mock**

In `src/renderer/src/pages/code/__tests__/index.test.ts`, update the useCodeTools mock to match new API (line 11-28):

```typescript
vi.mock('@renderer/hooks/useCodeTools', () => ({
  useCodeTools: () => ({
    selectedCliTool: codeCLI.qwenCode,
    selectedModel: null, // string | null now, not Model | null
    selectedTerminal: 'systemDefault',
    environmentVariables: '',
    directories: [],
    currentDirectory: '',
    canLaunch: true,
    setCliTool: vi.fn(),
    setModel: vi.fn(),
    setTerminal: vi.fn(),
    setEnvVars: vi.fn(),
    setCurrentDir: vi.fn(),
    removeDir: vi.fn(),
    selectFolder: vi.fn()
  })
}))
```

**Note:** Keep the `@renderer/store` mock in the page test — `CodeToolsPage.tsx` still uses `useAppSelector` directly for `defaultAssistant` (line 60). Only the `useCodeTools` mock needs updating.

- [ ] **Step 4: Run all affected tests**

```bash
pnpm test:renderer -- --run src/renderer/src/hooks/__tests__/useCodeTools.test.ts src/renderer/src/pages/code/__tests__/index.test.ts
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/hooks/useCodeTools.ts src/renderer/src/hooks/__tests__/useCodeTools.test.ts src/renderer/src/pages/code/__tests__/index.test.ts
git commit --signoff -m "feat: migrate useCodeTools hook from Redux to usePreference"
```

---

### Task 8: Final verification

- [ ] **Step 1: Run full test suite**

```bash
pnpm test
```
Expected: PASS

- [ ] **Step 2: Lint and format**

```bash
pnpm lint && pnpm format
```
Expected: PASS

- [ ] **Step 3: Build check**

```bash
pnpm build:check
```
Expected: PASS

- [ ] **Step 4: Final commit (if lint/format made changes)**

```bash
git add -A
git commit --signoff -m "chore: lint and format after codetools v2 migration"
```

---

## Follow-up (out of scope)

- `CodeToolsPage.tsx`: Adapt to new hook API (`selectedModel` is now `string | null`, setters are async). Also migrate antd → shadcn/tailwind.
- Remove Redux `codeTools.ts` slice once page is migrated.
- Remove `useAppSelector` for `defaultAssistant` in page (separate concern).
