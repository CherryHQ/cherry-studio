import type { TerminalCursorStyle } from '@shared/data/preference/preferenceTypes'

export type TerminalResourceId = string & { readonly __terminalResource: unique symbol }
export type TerminalGeneration = string & { readonly __terminalGeneration: unique symbol }
export type TerminalConversationId = string & { readonly __terminalConversation: unique symbol }
export interface TerminalHostIdentity {
  conversationId: TerminalConversationId
  generation: TerminalGeneration
}
export interface TerminalContext {
  contextId: string
  bindingId: string
  revision: number
}
export type TerminalControl = { kind: 'unassigned' } | { kind: 'agent'; context: TerminalContext } | { kind: 'user' }
export type TerminalProcessState =
  | { kind: 'not_started' | 'starting' | 'running' | 'closing' }
  | { kind: 'exited'; exitCode: number | null; signal: number | null }
  | { kind: 'lost'; message: string }
export type TerminalCleanup = 'none' | 'pending' | 'confirmed' | 'unconfirmed'
export type TerminalRetention = { kind: 'turn'; turnId: string } | { kind: 'session' }
export type TerminalStopReason =
  | 'agent_stop'
  | 'task_stop'
  | 'terminal_close'
  | 'runtime_released'
  | 'deadline'
  | 'user'
  | 'conversation_closed'
  | 'host_stopped'
  | 'root_exited'
export interface TerminalResourceState {
  id: TerminalResourceId
  host: TerminalHostIdentity
  kind: 'pipe' | 'pty'
  shell: 'bash' | 'powershell' | 'zsh' | 'other'
  context: TerminalContext
  process: TerminalProcessState
  cleanup: TerminalCleanup
  retention: TerminalRetention
  cancelRevision: number
  control: TerminalControl
  controlRevision: number
  revision: number
  outputCursor: number
  screenAvailable?: boolean
  geometryEpoch?: number
  shellFacts?: TerminalShellFacts
  command?: TerminalShellCommand
  stopReason?: TerminalStopReason
}

export interface TerminalCaptureRead {
  start: number
  next: number
  end: number
  truncated: boolean
  data: Uint8Array
}

export type TerminalRejection =
  | 'stale_context'
  | 'stale_generation'
  | 'stale_control'
  | 'closing'
  | 'capacity_exceeded'
  | 'admission_unavailable'
  | 'identity_conflict'
  | 'outcome_unknown'
  | 'unsupported'
  | 'busy'
export type TerminalReceipt =
  | { kind: 'resource'; resource: TerminalResourceState; inputHandled?: boolean }
  | { kind: 'context'; context: TerminalContext }
  | { kind: 'rejected'; reason: TerminalRejection }

export type TerminalShellFacts =
  | { kind: 'unknown' }
  | { kind: 'prompt'; revision: number; cwd: string }
  | { kind: 'program'; commandId: string; programRevision: number }
export type TerminalShellCommand = { id: string; start: number } & (
  | { status: 'running' }
  | { status: 'completed'; exitCode: number; end: number }
  | { status: 'unknown' }
)
export const GHOSTTY_CELL_WIDE = {
  narrow: 0,
  wide: 1,
  spacerTail: 2,
  spacerHead: 3
} as const

export interface GhosttyColor {
  readonly r: number
  readonly g: number
  readonly b: number
}

export interface GhosttyTheme {
  readonly foreground: GhosttyColor
  readonly background: GhosttyColor
  readonly cursor: GhosttyColor
  readonly cursorStyle?: TerminalCursorStyle
  readonly cursorBlink?: boolean
  readonly palette?: readonly GhosttyColor[]
  readonly selectionBackground?: string
}

export interface GhosttyCell {
  readonly text: string
  readonly wide: number
  readonly foreground: GhosttyColor
  readonly background: GhosttyColor
  readonly bold: boolean
  readonly italic: boolean
  readonly invisible: boolean
  readonly strikethrough: boolean
  readonly overline: boolean
  readonly underline: boolean
  readonly selected: boolean
}

export interface GhosttyRow {
  readonly cells: readonly GhosttyCell[]
  readonly text: string
  readonly isWrapContinuation: boolean
  readonly wrapsToNext: boolean
}

export interface GhosttySnapshot {
  readonly cols: number
  readonly rows: number
  readonly foreground: GhosttyColor
  readonly background: GhosttyColor
  readonly cursor: GhosttyColor
  readonly cursorX: number
  readonly cursorY: number
  readonly cursorVisible: boolean
  readonly cursorBlinking: boolean
  readonly cursorStyle: number
  readonly dirtyRows: ReadonlySet<number>
  readonly rowData: readonly GhosttyRow[]
}

export interface GhosttySelectionRange {
  readonly viewport: {
    readonly start: { readonly x: number; readonly y: number }
    readonly end: { readonly x: number; readonly y: number }
  }
  readonly screen: {
    readonly start: { readonly x: number; readonly y: number }
    readonly end: { readonly x: number; readonly y: number }
  }
}

export interface GhosttyScrollbar {
  readonly total: number
  readonly offset: number
  readonly len: number
}

export interface GhosttyPointInput {
  readonly x: number
  readonly y: number
  readonly tag?: 1 | 2
}

export interface GhosttyMouseInput {
  readonly action: 'press' | 'release' | 'motion'
  readonly button: number | null
  readonly mods: number
  readonly x: number
  readonly y: number
  readonly screenWidth: number
  readonly screenHeight: number
  readonly cellWidth: number
  readonly cellHeight: number
  readonly paddingLeft: number
  readonly paddingRight: number
  readonly paddingTop: number
  readonly paddingBottom: number
  readonly anyButtonPressed: boolean
}

export interface GhosttyKeyInput {
  readonly key: number
  readonly mods: number
  readonly consumedMods: number
  readonly composing: boolean
  readonly unshiftedCodepoint: number
  readonly text: string
  readonly repeat: boolean
}

export interface TerminalViewFrame {
  controlling: boolean
  scrollOffset: number
  viewId: string
  resource: TerminalResourceState
  geometryEpoch: number
  revision: number
  baseRevision: number | null
  rowStart: number
  rowIndices: number[]
  complete: boolean
  styles: TerminalCellStyle[]
  snapshot: Omit<GhosttySnapshot, 'dirtyRows' | 'rowData'> & { dirtyRows: number[]; rowData: TerminalWireRow[] }
}
export type TerminalCellStyle = readonly [number, number, number, number, number, number, number]
export interface TerminalWireRow {
  cells: (readonly [number, string, number])[]
  text: string
  isWrapContinuation: boolean
  wrapsToNext: boolean
}

export const GHOSTTY_KEY_CODES = [
  'Unidentified',
  'Backquote',
  'Backslash',
  'BracketLeft',
  'BracketRight',
  'Comma',
  'Digit0',
  'Digit1',
  'Digit2',
  'Digit3',
  'Digit4',
  'Digit5',
  'Digit6',
  'Digit7',
  'Digit8',
  'Digit9',
  'Equal',
  'IntlBackslash',
  'IntlRo',
  'IntlYen',
  'KeyA',
  'KeyB',
  'KeyC',
  'KeyD',
  'KeyE',
  'KeyF',
  'KeyG',
  'KeyH',
  'KeyI',
  'KeyJ',
  'KeyK',
  'KeyL',
  'KeyM',
  'KeyN',
  'KeyO',
  'KeyP',
  'KeyQ',
  'KeyR',
  'KeyS',
  'KeyT',
  'KeyU',
  'KeyV',
  'KeyW',
  'KeyX',
  'KeyY',
  'KeyZ',
  'Minus',
  'Period',
  'Quote',
  'Semicolon',
  'Slash',
  'AltLeft',
  'AltRight',
  'Backspace',
  'CapsLock',
  'ContextMenu',
  'ControlLeft',
  'ControlRight',
  'Enter',
  'MetaLeft',
  'MetaRight',
  'ShiftLeft',
  'ShiftRight',
  'Space',
  'Tab',
  'Convert',
  'KanaMode',
  'NonConvert',
  'Delete',
  'End',
  'Help',
  'Home',
  'Insert',
  'PageDown',
  'PageUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'NumLock',
  'Numpad0',
  'Numpad1',
  'Numpad2',
  'Numpad3',
  'Numpad4',
  'Numpad5',
  'Numpad6',
  'Numpad7',
  'Numpad8',
  'Numpad9',
  'NumpadAdd',
  'NumpadBackspace',
  'NumpadClear',
  'NumpadClearEntry',
  'NumpadComma',
  'NumpadDecimal',
  'NumpadDivide',
  'NumpadEnter',
  'NumpadEqual',
  'NumpadMemoryAdd',
  'NumpadMemoryClear',
  'NumpadMemoryRecall',
  'NumpadMemoryStore',
  'NumpadMemorySubtract',
  'NumpadMultiply',
  'NumpadParenLeft',
  'NumpadParenRight',
  'NumpadSubtract',
  'NumpadSeparator',
  'NumpadArrowUp',
  'NumpadArrowDown',
  'NumpadArrowRight',
  'NumpadArrowLeft',
  'NumpadBegin',
  'NumpadHome',
  'NumpadEnd',
  'NumpadInsert',
  'NumpadDelete',
  'NumpadPageUp',
  'NumpadPageDown',
  'Escape',
  'F1',
  'F2',
  'F3',
  'F4',
  'F5',
  'F6',
  'F7',
  'F8',
  'F9',
  'F10',
  'F11',
  'F12',
  'F13',
  'F14',
  'F15',
  'F16',
  'F17',
  'F18',
  'F19',
  'F20',
  'F21',
  'F22',
  'F23',
  'F24',
  'F25',
  'Fn',
  'FnLock',
  'PrintScreen',
  'ScrollLock',
  'Pause',
  'BrowserBack',
  'BrowserFavorites',
  'BrowserForward',
  'BrowserHome',
  'BrowserRefresh',
  'BrowserSearch',
  'BrowserStop',
  'Eject',
  'LaunchApp1',
  'LaunchApp2',
  'LaunchMail',
  'MediaPlayPause',
  'MediaSelect',
  'MediaStop',
  'MediaTrackNext',
  'MediaTrackPrevious',
  'Power',
  'Sleep',
  'AudioVolumeDown',
  'AudioVolumeMute',
  'AudioVolumeUp',
  'WakeUp',
  'Copy',
  'Cut',
  'Paste'
] as const
