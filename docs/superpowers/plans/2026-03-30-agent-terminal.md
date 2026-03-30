# Agent Terminal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persistent interactive terminal panel to Cherry Studio's Agent Session view using node-pty + xterm.js.

**Architecture:** Three-layer architecture — node-pty in main process manages PTY instances per session, IPC bridge transmits data bidirectionally, xterm.js in renderer renders the terminal in a collapsible bottom panel. Terminal is independent from Agent's Bash tool.

**Tech Stack:** node-pty, @xterm/xterm, @xterm/addon-fit, react-resizable-panels

**Spec:** `docs/superpowers/specs/2026-03-30-agent-terminal-design.md`

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `src/main/services/TerminalService.ts` | PTY lifecycle management (spawn, kill, data relay, resize) |
| Modify | `packages/shared/IpcChannel.ts` | Add terminal IPC channel enums |
| Modify | `src/preload/index.ts` | Add terminal IPC bridge methods |
| Modify | `src/main/ipc.ts` | Register terminal IPC handlers |
| Modify | `src/main/index.ts` | Initialize TerminalService, cleanup on quit |
| Create | `src/renderer/src/pages/agents/components/TerminalPanel.tsx` | xterm.js terminal component |
| Create | `src/renderer/src/hooks/useTerminal.ts` | Hook managing terminal IPC lifecycle |
| Modify | `src/renderer/src/pages/agents/AgentChat.tsx` | Integrate terminal panel into layout |

---

### Task 1: Install Dependencies

**Files:**
- Modify: `package.json` (via pnpm add)

- [ ] **Step 1: Install runtime dependencies**

```bash
pnpm add @xterm/xterm @xterm/addon-fit node-pty react-resizable-panels
```

- [ ] **Step 2: Verify installation**

```bash
pnpm install
```

Expected: No errors. `node_modules/@xterm/xterm`, `node_modules/node-pty`, `node_modules/react-resizable-panels` exist.

- [ ] **Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit --signoff -m "chore: add terminal dependencies (xterm, node-pty, react-resizable-panels)"
```

---

### Task 2: Add IPC Channel Definitions

**Files:**
- Modify: `packages/shared/IpcChannel.ts`

- [ ] **Step 1: Add terminal channels to the IpcChannel enum**

Add these entries at the end of the enum, before the closing brace (after the Analytics section):

```typescript
  // Terminal
  Terminal_Create = 'terminal:create',
  Terminal_OnData = 'terminal:on-data',
  Terminal_Write = 'terminal:write',
  Terminal_Resize = 'terminal:resize',
  Terminal_Kill = 'terminal:kill',
  Terminal_List = 'terminal:list',
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
pnpm typecheck
```

Expected: No errors related to IpcChannel.

- [ ] **Step 3: Commit**

```bash
git add packages/shared/IpcChannel.ts
git commit --signoff -m "feat(terminal): add IPC channel definitions"
```

---

### Task 3: Create TerminalService (Main Process)

**Files:**
- Create: `src/main/services/TerminalService.ts`

- [ ] **Step 1: Write the TerminalService**

Create `src/main/services/TerminalService.ts`:

```typescript
import { loggerService } from '@logger'
import os from 'node:os'
import path from 'node:path'
import { IpcChannel } from '@shared/IpcChannel'
import type { BrowserWindow } from 'electron'
import { ipcMain } from 'electron'
import type { IPty } from 'node-pty'
import { spawn } from 'node-pty'

const logger = loggerService.withContext('TerminalService')

interface TerminalSession {
  pty: IPty
  sessionId: string
  cwd: string
}

class TerminalService {
  private terminals = new Map<string, TerminalSession>()
  private mainWindow: BrowserWindow | null = null

  init(mainWindow: BrowserWindow): void {
    this.mainWindow = mainWindow
    this.registerIpcHandlers()
    logger.info('TerminalService initialized')
  }

  private registerIpcHandlers(): void {
    ipcMain.handle(IpcChannel.Terminal_Create, (_event, sessionId: string, cwd?: string, cols?: number, rows?: number) => {
      return this.create(sessionId, cwd, cols, rows)
    })

    ipcMain.handle(IpcChannel.Terminal_Write, (_event, sessionId: string, data: string) => {
      this.write(sessionId, data)
    })

    ipcMain.handle(IpcChannel.Terminal_Resize, (_event, sessionId: string, cols: number, rows: number) => {
      this.resize(sessionId, cols, rows)
    })

    ipcMain.handle(IpcChannel.Terminal_Kill, (_event, sessionId: string) => {
      this.kill(sessionId)
    })

    ipcMain.handle(IpcChannel.Terminal_List, () => {
      return this.list()
    })
  }

  create(sessionId: string, cwd?: string, cols: number = 80, rows: number = 24): { success: boolean; error?: string } {
    if (this.terminals.has(sessionId)) {
      return { success: true }
    }

    const resolvedCwd = cwd || os.homedir()

    try {
      const shell = this.getDefaultShell()
      const pty = spawn(shell, [], {
        cwd: resolvedCwd,
        cols,
        rows,
        env: { ...process.env } as Record<string, string>
      })

      const terminal: TerminalSession = { pty, sessionId, cwd: resolvedCwd }
      this.terminals.set(sessionId, terminal)

      pty.onData((data) => {
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          this.mainWindow.webContents.send(IpcChannel.Terminal_OnData, { sessionId, data })
        }
      })

      pty.onExit(({ exitCode }) => {
        logger.info(`Terminal exited for session ${sessionId}, code: ${exitCode}`)
        this.terminals.delete(sessionId)
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          this.mainWindow.webContents.send(IpcChannel.Terminal_OnData, {
            sessionId,
            data: `\r\n\x1b[90m[Process exited with code ${exitCode}]\x1b[0m\r\n`,
            exited: true,
            exitCode
          })
        }
      })

      logger.info(`Terminal created for session ${sessionId}, cwd: ${resolvedCwd}`)
      return { success: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.error(`Failed to create terminal for session ${sessionId}: ${message}`)
      return { success: false, error: message }
    }
  }

  write(sessionId: string, data: string): void {
    const terminal = this.terminals.get(sessionId)
    if (terminal) {
      terminal.pty.write(data)
    }
  }

  resize(sessionId: string, cols: number, rows: number): void {
    const terminal = this.terminals.get(sessionId)
    if (terminal) {
      try {
        terminal.pty.resize(cols, rows)
      } catch {
        // resize can fail if pty is exiting
      }
    }
  }

  kill(sessionId: string): void {
    const terminal = this.terminals.get(sessionId)
    if (terminal) {
      terminal.pty.kill()
      this.terminals.delete(sessionId)
      logger.info(`Terminal killed for session ${sessionId}`)
    }
  }

  list(): string[] {
    return Array.from(this.terminals.keys())
  }

  killAll(): void {
    for (const [sessionId, terminal] of this.terminals) {
      try {
        terminal.pty.kill()
      } catch {
        // ignore errors during cleanup
      }
    }
    this.terminals.clear()
    logger.info('All terminals killed')
  }

  private getDefaultShell(): string {
    if (process.platform === 'win32') {
      return process.env.COMSPEC || 'powershell.exe'
    }
    return process.env.SHELL || '/bin/bash'
  }
}

export const terminalService = new TerminalService()
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
pnpm typecheck
```

Expected: No errors related to TerminalService.

- [ ] **Step 3: Commit**

```bash
git add src/main/services/TerminalService.ts
git commit --signoff -m "feat(terminal): add TerminalService for PTY management"
```

---

### Task 4: Register TerminalService in App Lifecycle

**Files:**
- Modify: `src/main/index.ts` (init + cleanup)
- Modify: `src/main/ipc.ts` (import, no handler changes needed — TerminalService registers its own)

- [ ] **Step 1: Import and initialize TerminalService in `src/main/index.ts`**

Add import near other service imports (after `codeToolsService`):

```typescript
import { terminalService } from './services/TerminalService'
```

In the `app.whenReady()` block, after other service initializations, add:

```typescript
terminalService.init(mainWindow)
```

In the `app.on('will-quit')` handler, add cleanup:

```typescript
terminalService.killAll()
```

- [ ] **Step 2: Verify the app starts without errors**

```bash
pnpm dev
```

Expected: App starts, no errors in main process console about TerminalService.

- [ ] **Step 3: Commit**

```bash
git add src/main/index.ts
git commit --signoff -m "feat(terminal): register TerminalService in app lifecycle"
```

---

### Task 5: Add Preload Bridge for Terminal IPC

**Files:**
- Modify: `src/preload/index.ts`

- [ ] **Step 1: Add terminal namespace to the preload API**

Find the `codeTools` namespace in the `api` object (around line 380+) and add the terminal namespace after it:

```typescript
  terminal: {
    create: (sessionId: string, cwd?: string, cols?: number, rows?: number) =>
      ipcRenderer.invoke(IpcChannel.Terminal_Create, sessionId, cwd, cols, rows),
    write: (sessionId: string, data: string) =>
      ipcRenderer.invoke(IpcChannel.Terminal_Write, sessionId, data),
    resize: (sessionId: string, cols: number, rows: number) =>
      ipcRenderer.invoke(IpcChannel.Terminal_Resize, sessionId, cols, rows),
    kill: (sessionId: string) =>
      ipcRenderer.invoke(IpcChannel.Terminal_Kill, sessionId),
    list: () =>
      ipcRenderer.invoke(IpcChannel.Terminal_List),
    onData: (callback: (data: { sessionId: string; data: string; exited?: boolean; exitCode?: number }) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, data: { sessionId: string; data: string; exited?: boolean; exitCode?: number }) => {
        callback(data)
      }
      ipcRenderer.on(IpcChannel.Terminal_OnData, listener)
      return () => ipcRenderer.off(IpcChannel.Terminal_OnData, listener)
    }
  },
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
pnpm typecheck
```

Expected: No errors related to preload terminal types.

- [ ] **Step 3: Commit**

```bash
git add src/preload/index.ts
git commit --signoff -m "feat(terminal): add preload bridge for terminal IPC"
```

---

### Task 6: Create useTerminal Hook

**Files:**
- Create: `src/renderer/src/hooks/useTerminal.ts`

- [ ] **Step 1: Write the useTerminal hook**

Create `src/renderer/src/hooks/useTerminal.ts`:

```typescript
import { useEffect, useRef, useState, useCallback } from 'react'

interface UseTerminalOptions {
  sessionId: string
  cwd?: string
  visible: boolean
}

interface UseTerminalReturn {
  terminalReady: boolean
  error: string | null
  restart: () => void
}

export function useTerminal({ sessionId, cwd, visible }: UseTerminalOptions): UseTerminalReturn {
  const [terminalReady, setTerminalReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const cleanupRef = useRef<(() => void) | null>(null)

  const createTerminal = useCallback(async () => {
    if (!sessionId) return

    try {
      const result = await window.api.terminal.create(sessionId, cwd, 80, 24)
      if (result.success) {
        setTerminalReady(true)
        setError(null)
      } else {
        setError(result.error || 'Failed to create terminal')
        setTerminalReady(false)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setTerminalReady(false)
    }
  }, [sessionId, cwd])

  // Create terminal when panel becomes visible
  useEffect(() => {
    if (!visible || !sessionId) return

    createTerminal()
  }, [visible, sessionId, createTerminal])

  // Listen for terminal data
  useEffect(() => {
    if (!visible || !sessionId) return

    // Data listener is set up by the TerminalPanel component directly
    // via window.api.terminal.onData() since it needs xterm ref

    return () => {
      cleanupRef.current?.()
    }
  }, [visible, sessionId])

  // Cleanup terminal when session changes
  useEffect(() => {
    return () => {
      if (sessionId) {
        window.api.terminal.kill(sessionId).catch(() => {})
      }
      cleanupRef.current?.()
    }
  }, [sessionId])

  const restart = useCallback(() => {
    window.api.terminal.kill(sessionId).catch(() => {})
    setTerminalReady(false)
    setError(null)
    createTerminal()
  }, [sessionId, createTerminal])

  return { terminalReady, error, restart }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
pnpm typecheck
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/hooks/useTerminal.ts
git commit --signoff -m "feat(terminal): add useTerminal hook for IPC lifecycle"
```

---

### Task 7: Create TerminalPanel Component

**Files:**
- Create: `src/renderer/src/pages/agents/components/TerminalPanel.tsx`

- [ ] **Step 1: Write the TerminalPanel component**

Create `src/renderer/src/pages/agents/components/TerminalPanel.tsx`:

```tsx
import { useEffect, useRef, useCallback } from 'react'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'

interface TerminalPanelProps {
  sessionId: string
  cwd?: string
  visible: boolean
  onError: (error: string | null) => void
  onExited: () => void
}

const TerminalPanel = ({ sessionId, cwd, visible, onError, onExited }: TerminalPanelProps) => {
  const terminalRef = useRef<HTMLDivElement>(null)
  const xtermRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const cleanupDataRef = useRef<(() => void) | null>(null)
  const terminalCreatedRef = useRef(false)

  const initTerminal = useCallback(async () => {
    if (!terminalRef.current || !sessionId || terminalCreatedRef.current) return

    const result = await window.api.terminal.create(sessionId, cwd, 80, 24)
    if (!result.success) {
      onError(result.error || 'Failed to create terminal')
      return
    }

    const xterm = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      theme: {
        background: '#1e1e2e',
        foreground: '#cdd6f4'
      }
    })

    const fitAddon = new FitAddon()
    xterm.loadAddon(fitAddon)
    xterm.open(terminalRef.current)
    fitAddon.fit()

    // Handle user input
    xterm.onData((data) => {
      window.api.terminal.write(sessionId, data)
    })

    // Listen for PTY output
    const cleanupData = window.api.terminal.onData((event) => {
      if (event.sessionId !== sessionId) return
      if (xtermRef.current) {
        xtermRef.current.write(event.data)
      }
      if (event.exited) {
        terminalCreatedRef.current = false
        onExited()
      }
    })

    xtermRef.current = xterm
    fitAddonRef.current = fitAddon
    cleanupDataRef.current = cleanupData
    terminalCreatedRef.current = true
    onError(null)
  }, [sessionId, cwd, onError, onExited])

  // Create terminal when panel becomes visible
  useEffect(() => {
    if (visible && sessionId) {
      initTerminal()
    }
  }, [visible, sessionId, initTerminal])

  // Handle resize
  useEffect(() => {
    if (!visible) return

    const observer = new ResizeObserver(() => {
      if (fitAddonRef.current && xtermRef.current) {
        try {
          fitAddonRef.current.fit()
          const dims = fitAddonRef.current.proposeDimensions()
          if (dims) {
            window.api.terminal.resize(sessionId, dims.cols, dims.rows)
          }
        } catch {
          // ignore resize errors
        }
      }
    })

    if (terminalRef.current) {
      observer.observe(terminalRef.current)
    }

    return () => observer.disconnect()
  }, [visible, sessionId])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanupDataRef.current?.()
      xtermRef.current?.dispose()
      xtermRef.current = null
      fitAddonRef.current = null
      terminalCreatedRef.current = false
    }
  }, [])

  return (
    <div
      ref={terminalRef}
      style={{
        width: '100%',
        height: '100%',
        backgroundColor: '#1e1e2e',
        padding: '4px 8px'
      }}
    />
  )
}

export default TerminalPanel
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
pnpm typecheck
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/pages/agents/components/TerminalPanel.tsx
git commit --signoff -m "feat(terminal): add TerminalPanel component with xterm.js"
```

---

### Task 8: Integrate Terminal Panel into AgentChat Layout

**Files:**
- Modify: `src/renderer/src/pages/agents/AgentChat.tsx`

- [ ] **Step 1: Add imports and state**

Add imports at the top of `AgentChat.tsx`:

```typescript
import { Terminal as TerminalIcon } from 'lucide-react'
import { ImperativePanelHandle, Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import TerminalPanel from './components/TerminalPanel'
```

Add state inside the `AgentChat` component, after the existing hooks:

```typescript
const [terminalVisible, setTerminalVisible] = useState(false)
const [terminalError, setTerminalError] = useState<string | null>(null)
const terminalPanelRef = useRef<ImperativePanelHandle>(null)
```

Add `useRef` to the React import at the top.

- [ ] **Step 2: Replace the messages + inputbar section with PanelGroup**

Replace the section inside the main `<div className="flex min-w-0 flex-1 flex-col">` (lines 92-110 in the original) with:

```tsx
<div className="flex min-w-0 flex-1 flex-col">
  {/* Header */}
  <div className="flex h-fit w-full min-w-0">
    {activeAgent && <AgentChatNavbar className="min-w-0" activeAgent={activeAgent} />}
  </div>

  {/* Messages + Terminal Split */}
  <PanelGroup direction="vertical" className="flex-1">
    {/* Messages */}
    <Panel defaultSize={terminalVisible ? 70 : 100} minSize={20}>
      <div className="translate-z-0 relative flex h-full w-full flex-col justify-between overflow-y-auto overflow-x-hidden">
        <AgentSessionMessages agentId={activeAgentId} sessionId={activeSessionId} />
        <div className="mt-auto px-4.5 pb-2">
          <NarrowLayout>
            <PinnedTodoPanel topicId={buildAgentSessionTopicId(activeSessionId)} />
          </NarrowLayout>
        </div>
        {messageNavigation === 'buttons' && <ChatNavigation containerId="messages" />}
      </div>
    </Panel>

    {/* Terminal Panel */}
    {terminalVisible && (
      <>
        <PanelResizeHandle className="flex h-1 items-center justify-center bg-[var(--color-border)] transition-colors hover:bg-[var(--color-primary)]" />
        <Panel ref={terminalPanelRef} defaultSize={30} minSize={15} collapsible>
          <div className="flex h-full flex-col">
            <div className="flex items-center justify-between border-b border-[var(--color-border)] px-3 py-1">
              <span className="text-xs text-[var(--color-text-secondary)]">Terminal</span>
              <div className="flex items-center gap-1">
                {terminalError && (
                  <span className="mr-2 text-xs text-red-400">{terminalError}</span>
                )}
                <button
                  onClick={() => setTerminalVisible(false)}
                  className="text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text)]">
                  Hide
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-hidden">
              <TerminalPanel
                sessionId={activeSessionId}
                cwd={activeAgent?.accessible_paths?.[0]}
                visible={terminalVisible}
                onError={setTerminalError}
                onExited={() => setTerminalVisible(false)}
              />
            </div>
          </div>
        </Panel>
      </>
    )}
  </PanelGroup>

  {/* Inputbar + Terminal Toggle */}
  <div>
    <AgentSessionInputbar agentId={activeAgentId} sessionId={activeSessionId} />
    {/* Terminal toggle button */}
    {!terminalVisible && (
      <button
        onClick={() => setTerminalVisible(true)}
        className="absolute bottom-20 right-4 z-10 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] p-1.5 shadow-md hover:bg-[var(--color-hover)]"
        title="Open Terminal">
        <TerminalIcon size={16} className="text-[var(--color-text-secondary)]" />
      </button>
    )}
  </div>
</div>
```

Note: The toggle button uses `absolute` positioning to float over the chat. If the exact position needs adjustment, tweak `bottom-20 right-4` values.

- [ ] **Step 3: Verify TypeScript compiles**

```bash
pnpm typecheck
```

Expected: No errors related to AgentChat or TerminalPanel.

- [ ] **Step 4: Verify the app runs**

```bash
pnpm dev
```

Manual test:
1. Open Cherry Studio
2. Navigate to an Agent session
3. Look for the terminal toggle button (bottom-right)
4. Click it — terminal panel should appear in the bottom
5. Type a command (e.g., `ls`) — output should appear
6. Click "Hide" — terminal panel should collapse
7. Click the toggle again — terminal should reappear with the same session

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/pages/agents/AgentChat.tsx
git commit --signoff -m "feat(terminal): integrate terminal panel into AgentChat layout"
```

---

### Task 9: Handle Electron Build Config for node-pty

**Files:**
- Potentially modify: `electron.vite.config.ts` or equivalent build config

- [ ] **Step 1: Check if node-pty is handled as external**

`node-pty` is a native Node.js addon. Electron-vite needs to mark it as external for the main process build. Check `electron.vite.config.ts`:

```bash
grep -n "external" electron.vite.config.ts
```

If `node-pty` is not in the externals list, add it. The pattern in electron-vite is:

```typescript
main: {
  resolve: {
    // node-pty is a native module, must be external
  },
  build: {
    rollupOptions: {
      external: ['node-pty']
    }
  }
}
```

- [ ] **Step 2: Verify build works**

```bash
pnpm build
```

Expected: Build completes without errors about `node-pty`.

- [ ] **Step 3: Commit (if changes were needed)**

```bash
git add electron.vite.config.ts
git commit --signoff -m "fix(terminal): mark node-pty as external in electron-vite config"
```

---

### Task 10: Final Verification and Polish

**Files:**
- All terminal-related files

- [ ] **Step 1: Run full build check**

```bash
pnpm build:check
```

Expected: All lint, typecheck, and tests pass.

- [ ] **Step 2: Manual testing checklist**

Test these scenarios:
1. Terminal opens and accepts input
2. Command output displays correctly (try `ls`, `echo hello`, `pwd`)
3. Terminal resize works (drag the divider)
4. Terminal hides and re-shows correctly
5. Switching between agent sessions preserves terminal state
6. Closing an agent session kills its terminal
7. Running `exit` in terminal shows exit message and allows re-opening
8. App quit cleans up all terminals (no zombie processes)

- [ ] **Step 3: Fix any issues found during testing**

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit --signoff -m "feat(terminal): add interactive terminal panel to agent sessions"
```
