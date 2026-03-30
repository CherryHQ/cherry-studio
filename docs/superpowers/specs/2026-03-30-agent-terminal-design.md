# Agent Terminal Feature Design

## Overview

Add a persistent interactive terminal panel to Cherry Studio's Agent Session view. Each Agent Session gets its own PTY-based terminal, independent from the Agent's Bash tool. The terminal renders via xterm.js in the renderer and communicates with node-pty in the main process through IPC.

## Requirements

- Bottom collapsible terminal panel in the Agent Session view
- One PTY instance per Agent Session, lazily created on first expand
- Terminal cwd defaults to the Agent's first `accessible_path`, or `os.homedir()` if none set
- Terminal and Agent's Bash tool are completely independent
- Panel state (expanded/collapsed, height) persists per Session during app lifetime

## Architecture

Three-layer architecture:

```
Renderer (xterm.js)  <-->  IPC Bridge (preload)  <-->  Main (node-pty)
```

## Main Process: TerminalService

**File**: `src/main/services/agents/services/TerminalService.ts`

Manages all active PTY instances in a `Map<sessionId, IPty>`.

### Responsibilities

- Create PTY: `node-pty.spawn(shell, [], { cwd, env, cols, rows })`
- Destroy PTY: kill process and remove reference on session close
- Forward PTY `onData` stream to renderer via IPC
- Receive keyboard input from renderer, write to PTY stdin
- Handle resize events when terminal panel dimensions change
- Batch kill all PTY instances on app quit

### Shell Selection

- Windows: `powershell.exe`
- macOS/Linux: `process.env.SHELL` (fallback to `/bin/bash`)
- Environment variables inherited from main process

### IPC Channels (new in `packages/shared/IpcChannel.ts`)

| Channel | Direction | Payload |
|---------|-----------|---------|
| `Terminal_Create` | renderer -> main | `{ sessionId, cwd, cols, rows }` |
| `Terminal_OnData` | main -> renderer | `{ sessionId, data }` |
| `Terminal_Write` | renderer -> main | `{ sessionId, data }` |
| `Terminal_Resize` | renderer -> main | `{ sessionId, cols, rows }` |
| `Terminal_Kill` | renderer -> main | `{ sessionId }` |
| `Terminal_List` | renderer -> main | (none) returns active session IDs |

## Renderer: Terminal Panel

### Layout Change

Insert point in `Chat.tsx` session branch, between the message area and input bar:

```
+-------------------------------------+
| AgentSessionMessages (flex-1)       |  <- resizable
+-------------------------------------+  <- drag divider
| TerminalPanel (collapsible)         |  <- default collapsed
|   [xterm.js render area]           |
+-------------------------------------+
| AgentSessionInputbar                |  <- fixed at bottom
+-------------------------------------+
```

### Components

**`TerminalPanel`** (`src/renderer/src/pages/home/TerminalPanel/`):
- Container with title bar showing cwd, collapse/expand button, close button
- xterm.js instance with `@xterm/addon-fit` for auto-sizing
- Handles IPC communication for data flow and resize

**`TerminalPanelContainer`**:
- Wraps the session content area (messages + terminal) in a vertical split layout
- Uses `react-resizable-panels` for the split
- Persists panel state per session (expanded/collapsed, height)
- Lazy creates PTY on first expand

### New Dependencies

- `@xterm/xterm` - terminal rendering
- `@xterm/addon-fit` - auto-fit to container size
- `react-resizable-panels` - split panel layout
- `node-pty` - pseudo-terminal (main process only)

## Data Flow

```
Keyboard input -> xterm.js -> IPC Terminal_Write -> PTY stdin
PTY stdout/stderr -> IPC Terminal_OnData -> xterm.js.write()
Panel resize -> react-resizable-panels -> IPC Terminal_Resize -> pty.resize()
```

## State Management

- PTY instance map lives in main process `TerminalService` (no Redux needed)
- Renderer uses local state: `Map<sessionId, { visible: boolean, height: number }>`
- On session switch: save current panel state, restore target session's panel state

## Lifecycle

1. User expands terminal panel -> Renderer sends `Terminal_Create` -> Main spawns PTY
2. Terminal visible -> bidirectional data stream active
3. User collapses terminal -> PTY keeps running (user may re-expand)
4. Session deleted / Agent deleted -> Main kills PTY + cleanup
5. App quits -> Main batch kills all PTY instances

## Error Handling

- PTY spawn failure (shell not found) -> terminal panel shows error message with retry button
- PTY process exit -> show exit code with "Restart Terminal" button
- IPC disconnect -> terminal shows "Connection lost", auto-reconnect
- User runs `exit` in terminal -> PTY exits, show "Session ended" with restart button

## Edge Cases

- No `accessible_paths` configured -> cwd defaults to `os.homedir()`
- Frequent session switching -> lazy loading, only create PTY for sessions user actually expands
- Window minimize/restore -> `@xterm/addon-fit` handles resize automatically

## Out of Scope (YAGNI)

- Multiple terminal tabs per session
- Terminal theme customization (use xterm.js default theme)
- Terminal content copy/paste (xterm.js default behavior is sufficient)
- Terminal history persistence across app restarts
- Integration between Agent Bash tool and terminal panel
