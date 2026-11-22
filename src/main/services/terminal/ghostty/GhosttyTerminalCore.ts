import {
  GHOSTTY_CELL_WIDE,
  type GhosttyColor,
  type GhosttyTheme,
  type GhosttyCell,
  type GhosttyRow,
  type GhosttySnapshot,
  type GhosttySelectionRange,
  type GhosttyScrollbar,
  type GhosttyPointInput,
  type GhosttyMouseInput,
  type GhosttyKeyInput
} from '@shared/types/terminal'
// Adapted from T3 Code, copyright (c) 2026 T3 Tools Inc. (MIT).
// Provenance and license: resources/terminal/ghostty/README.md.

import { GhosttySearchCapacityError, type GhosttyAllocationBudget, type GhosttyRuntime } from './GhosttyRuntime'

export { GhosttySearchCapacityError } from './GhosttyRuntime'

const GHOSTTY_SUCCESS = 0
const GHOSTTY_OUT_OF_SPACE = -3
const PALETTE_BYTES = 256 * 3

const RENDER_DATA = {
  cols: 1,
  rows: 2,
  dirty: 3,
  rowIterator: 4,
  background: 5,
  foreground: 6,
  cursor: 7,
  cursorHasValue: 8,
  cursorStyle: 10,
  cursorVisible: 11,
  cursorBlinking: 12,
  cursorInViewport: 14,
  cursorX: 15,
  cursorY: 16
} as const

const ROW_DATA = {
  dirty: 1,
  raw: 2,
  cells: 3
} as const

const CELL_DATA = {
  raw: 1,
  style: 2,
  graphemesLength: 3,
  graphemes: 4,
  background: 5,
  foreground: 6,
  selected: 7
} as const

// Optional row_cells_get_multi colors must come last; an unset color stops the query.
const CELL_QUERY = {
  keys: 0,
  values: 20,
  graphemesLength: 40,
  selected: 44,
  background: 48,
  foreground: 52,
  written: 56,
  size: 60
} as const

const RAW_CELL_DATA = {
  wide: 3
} as const

export { GHOSTTY_CELL_WIDE } from '@shared/types/terminal'
export type {
  GhosttyColor,
  GhosttyTheme,
  GhosttyCell,
  GhosttyRow,
  GhosttySnapshot,
  GhosttySelectionRange,
  GhosttyScrollbar,
  GhosttyPointInput,
  GhosttyMouseInput,
  GhosttyKeyInput
} from '@shared/types/terminal'
export interface GhosttyTerminalOptions {
  runtime: GhosttyRuntime
  cols: number
  rows: number
  cellWidth: number
  cellHeight: number
  scrollbackBytes: number
  theme: GhosttyTheme
  onPtyData: (data: string) => void
}

const decoder = new TextDecoder('utf-8', { ignoreBOM: true })
const encoder = new TextEncoder()

export interface GhosttySearchProjection {
  status: 'running' | 'feed-required' | 'complete'
  count: number
  selected: { index: number; range: GhosttySelectionRange['screen'] } | null
  matches: GhosttySelectionRange['screen'][]
  highlightsLimited: boolean
}

function blend(foreground: GhosttyColor, background: GhosttyColor): GhosttyColor {
  const channel = (front: number, back: number) => Math.floor((front * 155 + back * 100) / 255)
  return {
    r: channel(foreground.r, background.r),
    g: channel(foreground.g, background.g),
    b: channel(foreground.b, background.b)
  }
}

function sameColor(left: GhosttyColor, right: GhosttyColor): boolean {
  return left.r === right.r && left.g === right.g && left.b === right.b
}

/** Bounds String.fromCodePoint arguments for cells with enormous combining-mark sequences. */
export function ghosttyCellText(codepointView: DataView, graphemeLength: number, byteOffset = 0): string {
  if (graphemeLength === 1) return String.fromCodePoint(codepointView.getUint32(byteOffset, true))
  const CHUNK_SIZE = 4_096
  let text = ''
  for (let start = 0; start < graphemeLength; start += CHUNK_SIZE) {
    const count = Math.min(CHUNK_SIZE, graphemeLength - start)
    const codes = new Array<number>(count)
    for (let index = 0; index < count; index += 1) {
      codes[index] = codepointView.getUint32(byteOffset + (start + index) * 4, true)
    }
    text += String.fromCodePoint(...codes)
  }
  return text
}

export class GhosttyTerminalCore {
  private readonly runtime: GhosttyRuntime
  private terminalSlot = 0
  private terminal = 0
  private renderStateSlot = 0
  private renderState = 0
  private rowIteratorSlot = 0
  private rowCellsSlot = 0
  private keyEncoderSlot = 0
  private keyEncoder = 0
  private keyEventSlot = 0
  private keyEvent = 0
  private mouseEncoderSlot = 0
  private mouseEncoder = 0
  private mouseEventSlot = 0
  private mouseEvent = 0
  private ptyWriterId = 0
  private scratch = 0
  private graphemes = 0
  private graphemeCapacity = 0
  private style = 0
  private cellQuery = 0
  private scrollbar = 0
  private rows: GhosttyRow[] = []
  private disposed = false
  revision = 0
  private readonly anchors = new Map<string, number>()
  private readonly searches = new Map<string, { handle: number; slot: number; budget: GhosttyAllocationBudget }>()

  private constructor(runtime: GhosttyRuntime) {
    this.runtime = runtime
  }

  static create(options: GhosttyTerminalOptions): GhosttyTerminalCore {
    const core = new GhosttyTerminalCore(options.runtime)
    try {
      core.initialize(options)
      return core
    } catch (error) {
      core.dispose()
      throw error
    }
  }

  private initialize({
    cols,
    rows,
    cellWidth,
    cellHeight,
    theme,
    onPtyData,
    scrollbackBytes
  }: GhosttyTerminalOptions): void {
    this.terminalSlot = this.runtime.allocOpaque()
    const terminalResult = this.runtime.call('ghostty_terminal_new', 0, this.terminalSlot, cols, rows)
    this.assertSuccess('ghostty_terminal_new', terminalResult)
    this.terminal = this.runtime.readPointer(this.terminalSlot)
    this.ptyWriterId = this.runtime.attachPtyWriter(this.terminal, onPtyData)

    this.renderStateSlot = this.runtime.allocOpaque()
    this.assertSuccess(
      'ghostty_render_state_new',
      this.runtime.call('ghostty_render_state_new', 0, this.renderStateSlot)
    )
    this.renderState = this.runtime.readPointer(this.renderStateSlot)

    this.rowIteratorSlot = this.runtime.allocOpaque()
    this.assertSuccess(
      'ghostty_render_state_row_iterator_new',
      this.runtime.call('ghostty_render_state_row_iterator_new', 0, this.rowIteratorSlot)
    )
    this.rowCellsSlot = this.runtime.allocOpaque()
    this.assertSuccess(
      'ghostty_render_state_row_cells_new',
      this.runtime.call('ghostty_render_state_row_cells_new', 0, this.rowCellsSlot)
    )

    this.keyEncoderSlot = this.runtime.allocOpaque()
    this.assertSuccess('ghostty_key_encoder_new', this.runtime.call('ghostty_key_encoder_new', 0, this.keyEncoderSlot))
    this.keyEncoder = this.runtime.readPointer(this.keyEncoderSlot)
    this.keyEventSlot = this.runtime.allocOpaque()
    this.assertSuccess('ghostty_key_event_new', this.runtime.call('ghostty_key_event_new', 0, this.keyEventSlot))
    this.keyEvent = this.runtime.readPointer(this.keyEventSlot)

    this.mouseEncoderSlot = this.runtime.allocOpaque()
    this.assertSuccess(
      'ghostty_mouse_encoder_new',
      this.runtime.call('ghostty_mouse_encoder_new', 0, this.mouseEncoderSlot)
    )
    this.mouseEncoder = this.runtime.readPointer(this.mouseEncoderSlot)
    this.mouseEventSlot = this.runtime.allocOpaque()
    this.assertSuccess('ghostty_mouse_event_new', this.runtime.call('ghostty_mouse_event_new', 0, this.mouseEventSlot))
    this.mouseEvent = this.runtime.readPointer(this.mouseEventSlot)

    this.scratch = this.runtime.alloc(16)
    this.runtime.view(this.scratch, 4).setUint32(0, scrollbackBytes, true)
    this.assertSuccess(
      'ghostty_terminal_set(scrollback)',
      this.runtime.call(
        'ghostty_terminal_set',
        this.terminal,
        this.runtime.enumValue('GhosttyTerminalOption', 'SCROLLBACK_MAX_BYTES'),
        this.scratch
      )
    )
    const styleSize = this.runtime.layout('GhosttyStyle').size
    this.style = this.runtime.alloc(styleSize)
    this.cellQuery = this.runtime.alloc(CELL_QUERY.size)
    const queryView = this.runtime.memoryDataView()
    const cellFields = [
      [CELL_DATA.style, this.style],
      [CELL_DATA.graphemesLength, this.cellQuery + CELL_QUERY.graphemesLength],
      [CELL_DATA.selected, this.cellQuery + CELL_QUERY.selected],
      [CELL_DATA.background, this.cellQuery + CELL_QUERY.background],
      [CELL_DATA.foreground, this.cellQuery + CELL_QUERY.foreground]
    ] as const
    for (const [index, [key, pointer]] of cellFields.entries()) {
      queryView.setUint32(this.cellQuery + CELL_QUERY.keys + index * 4, key, true)
      queryView.setUint32(this.cellQuery + CELL_QUERY.values + index * 4, pointer, true)
    }
    this.scrollbar = this.runtime.alloc(this.runtime.layout('GhosttyTerminalScrollbar').size)
    this.setTheme(theme)
    this.resize(cols, rows, cellWidth, cellHeight)
  }

  write(data: string | Uint8Array, onSynchronizedOutputEnd?: () => void): void {
    this.ensureActive()
    const bytes = typeof data === 'string' ? encoder.encode(data) : data
    if (bytes.length === 0) return
    this.revision++
    const pointer = this.runtime.alloc(bytes.length)
    this.runtime.bytes(pointer, bytes.length).set(bytes)
    // Observe a synchronized-output end before a following escape can reopen it.
    // Ghostty still parses OSC/DCS and split VT sequences itself.
    let synchronized = onSynchronizedOutputEnd !== undefined && this.isSynchronizedOutput()
    try {
      for (let start = 0; start < bytes.length;) {
        const nextEscape = synchronized ? bytes.indexOf(0x1b, start + 1) : -1
        const end = nextEscape === -1 ? bytes.length : nextEscape
        this.runtime.call('ghostty_terminal_vt_write', this.terminal, pointer + start, end - start)
        start = end
        if (synchronized && !this.isSynchronizedOutput()) {
          synchronized = false
          onSynchronizedOutputEnd?.()
        }
      }
    } finally {
      this.runtime.free(pointer, bytes.length)
    }
  }

  resize(cols: number, rows: number, cellWidth: number, cellHeight: number): void {
    this.ensureActive()
    this.revision++
    this.assertSuccess(
      'ghostty_terminal_resize',
      this.runtime.call(
        'ghostty_terminal_resize',
        this.terminal,
        Math.max(1, Math.min(65_535, cols)),
        Math.max(1, Math.min(65_535, rows)),
        Math.max(1, Math.round(cellWidth)),
        Math.max(1, Math.round(cellHeight))
      )
    )
  }

  setTheme(theme: GhosttyTheme): void {
    this.ensureActive()
    const color = this.runtime.alloc(3)
    for (const [option, value] of [
      [this.runtime.enumValue('GhosttyTerminalOption', 'COLOR_FOREGROUND'), theme.foreground],
      [this.runtime.enumValue('GhosttyTerminalOption', 'COLOR_BACKGROUND'), theme.background],
      [this.runtime.enumValue('GhosttyTerminalOption', 'COLOR_CURSOR'), theme.cursor]
    ] as const) {
      this.runtime.bytes(color, 3).set([value.r, value.g, value.b])
      this.runtime.call('ghostty_terminal_set', this.terminal, option, color)
    }
    this.runtime.free(color, 3)
    // Native defaults update immediately unless a program has explicitly set its cursor.
    const cursor = this.runtime.alloc(4)
    const styles = { bar: 0, block: 1, underline: 2 } as const
    this.runtime.view(cursor, 4).setUint32(0, styles[theme.cursorStyle ?? 'block'], true)
    this.runtime.call(
      'ghostty_terminal_set',
      this.terminal,
      this.runtime.enumValue('GhosttyTerminalOption', 'DEFAULT_CURSOR_STYLE'),
      cursor
    )
    this.runtime.bytes(cursor, 1)[0] = Number(theme.cursorBlink ?? true)
    this.runtime.call(
      'ghostty_terminal_set',
      this.terminal,
      this.runtime.enumValue('GhosttyTerminalOption', 'DEFAULT_CURSOR_BLINK'),
      cursor
    )
    this.runtime.free(cursor, 4)
    if (theme.palette) this.setPalette(theme.palette)
  }

  private setPalette(colors: readonly GhosttyColor[]): void {
    const palette = this.runtime.alloc(PALETTE_BYTES)
    this.runtime.call('ghostty_terminal_get', this.terminal, 25, palette)
    const bytes = this.runtime.bytes(palette, PALETTE_BYTES)
    colors.slice(0, 16).forEach((color, index) => {
      bytes.set([color.r, color.g, color.b], index * 3)
    })
    this.runtime.call(
      'ghostty_terminal_set',
      this.terminal,
      this.runtime.enumValue('GhosttyTerminalOption', 'COLOR_PALETTE'),
      palette
    )
    this.runtime.free(palette, PALETTE_BYTES)
  }

  scroll(deltaRows: number): void {
    this.ensureActive()
    const layout = this.runtime.layout('GhosttyTerminalScrollViewport')
    const scroll = this.runtime.alloc(layout.size)
    this.runtime.setField(scroll, 'GhosttyTerminalScrollViewport', 'tag', 2)
    const value = layout.fields.value
    this.runtime.view(scroll + value.offset, value.size).setInt32(0, deltaRows, true)
    this.runtime.call('ghostty_terminal_scroll_viewport', this.terminal, scroll)
    this.runtime.free(scroll, layout.size)
  }

  scrollToBottom(): void {
    this.ensureActive()
    const layout = this.runtime.layout('GhosttyTerminalScrollViewport')
    const scroll = this.runtime.alloc(layout.size)
    this.runtime.setField(scroll, 'GhosttyTerminalScrollViewport', 'tag', 1)
    this.runtime.call('ghostty_terminal_scroll_viewport', this.terminal, scroll)
    this.runtime.free(scroll, layout.size)
  }

  isViewportActive(): boolean {
    this.ensureActive()
    this.runtime.bytes(this.scratch, 1)[0] = 0
    return (
      this.runtime.call('ghostty_terminal_get', this.terminal, 32, this.scratch) === GHOSTTY_SUCCESS &&
      this.runtime.bytes(this.scratch, 1)[0] !== 0
    )
  }

  scrollbarState(): GhosttyScrollbar | null {
    this.ensureActive()
    const layout = this.runtime.layout('GhosttyTerminalScrollbar')
    this.runtime.bytes(this.scrollbar, layout.size).fill(0)
    if (this.runtime.call('ghostty_terminal_get', this.terminal, 9, this.scrollbar) !== GHOSTTY_SUCCESS) {
      return null
    }
    return {
      total: this.runtime.readField(this.scrollbar, 'GhosttyTerminalScrollbar', 'total'),
      offset: this.runtime.readField(this.scrollbar, 'GhosttyTerminalScrollbar', 'offset'),
      len: this.runtime.readField(this.scrollbar, 'GhosttyTerminalScrollbar', 'len')
    }
  }

  isMouseTracking(): boolean {
    this.ensureActive()
    this.runtime.bytes(this.scratch, 1)[0] = 0
    return (
      this.runtime.call('ghostty_terminal_get', this.terminal, 11, this.scratch) === GHOSTTY_SUCCESS &&
      this.runtime.bytes(this.scratch, 1)[0] !== 0
    )
  }

  isMouseAnyEventTracking(): boolean {
    return this.mode(1003)
  }

  isSynchronizedOutput(): boolean {
    return this.mode(2026)
  }

  endSynchronizedOutput(): void {
    this.ensureActive()
    this.runtime.bytes(this.scratch, this.runtime.layout('GhosttyTerminalModeConfig').size).fill(0)
    this.runtime.setField(this.scratch, 'GhosttyTerminalModeConfig', 'mode', 2026)
    this.assertSuccess(
      'ghostty_terminal_set(mode)',
      this.runtime.call(
        'ghostty_terminal_set',
        this.terminal,
        this.runtime.enumValue('GhosttyTerminalOption', 'MODE'),
        this.scratch
      )
    )
  }

  isAlternateScreen(): boolean {
    this.ensureActive()
    this.runtime.bytes(this.scratch, 4).fill(0)
    return (
      this.runtime.call('ghostty_terminal_get', this.terminal, 6, this.scratch) === GHOSTTY_SUCCESS &&
      this.runtime.view(this.scratch, 4).getUint32(0, true) === 1
    )
  }

  isApplicationCursorKeys(): boolean {
    return this.mode(1)
  }

  private mode(number: number): boolean {
    this.ensureActive()
    this.runtime.bytes(this.scratch, this.runtime.layout('GhosttyTerminalModeConfig').size).fill(0)
    this.runtime.setField(this.scratch, 'GhosttyTerminalModeConfig', 'mode', number)
    return (
      this.runtime.call(
        'ghostty_terminal_get',
        this.terminal,
        this.runtime.enumValue('GhosttyTerminalData', 'MODE'),
        this.scratch
      ) === GHOSTTY_SUCCESS && this.runtime.readField(this.scratch, 'GhosttyTerminalModeConfig', 'value') !== 0
    )
  }

  encodeKey(event: GhosttyKeyInput, action: 'press' | 'release' = 'press'): string {
    this.ensureActive()
    this.runtime.call('ghostty_key_encoder_set_from_terminal', this.keyEncoder, this.terminal)
    this.runtime.call('ghostty_key_event_set_action', this.keyEvent, action === 'release' ? 0 : event.repeat ? 2 : 1)
    this.runtime.call('ghostty_key_event_set_key', this.keyEvent, event.key)
    const mods = event.mods
    this.runtime.call('ghostty_key_event_set_mods', this.keyEvent, mods)
    this.runtime.call('ghostty_key_event_set_consumed_mods', this.keyEvent, event.consumedMods)
    this.runtime.call('ghostty_key_event_set_composing', this.keyEvent, event.composing ? 1 : 0)
    this.runtime.call('ghostty_key_event_set_unshifted_codepoint', this.keyEvent, event.unshiftedCodepoint)

    const text = event.text
    const textBytes = encoder.encode(text)
    const textPointer = textBytes.length === 0 ? 0 : this.runtime.alloc(textBytes.length)
    if (textPointer !== 0) this.runtime.bytes(textPointer, textBytes.length).set(textBytes)
    const stringSize = this.runtime.layout('GhosttyString').size
    const string = this.runtime.alloc(stringSize)
    const written = this.runtime.alloc(4)
    try {
      this.runtime.setField(string, 'GhosttyString', 'ptr', textPointer)
      this.runtime.setField(string, 'GhosttyString', 'len', textBytes.length)
      this.assertSuccess(
        'ghostty_key_event_set_utf8',
        this.runtime.call('ghostty_key_event_set_utf8', this.keyEvent, string)
      )
      return this.encodeOutput(written, (output, outputSize) =>
        this.runtime.call('ghostty_key_encoder_encode', this.keyEncoder, this.keyEvent, output, outputSize, written)
      )
    } finally {
      this.runtime.free(written, 4)
      this.runtime.bytes(string, stringSize).fill(0)
      this.runtime.call('ghostty_key_event_set_utf8', this.keyEvent, string)
      this.runtime.free(string, stringSize)
      if (textPointer !== 0) this.runtime.free(textPointer, textBytes.length)
    }
  }

  encodePaste(data: string): string {
    this.ensureActive()
    const input = encoder.encode(data)
    if (input.length === 0) return ''
    const inputPointer = this.runtime.alloc(input.length)
    this.runtime.bytes(inputPointer, input.length).set(input)
    this.runtime.bytes(this.scratch, 1)[0] = 0
    const bracketed = this.mode(2004)
    const written = this.runtime.call('ghostty_wasm_alloc', 4)
    let encoded = ''
    const sizeResult = this.runtime.call(
      'ghostty_paste_encode',
      inputPointer,
      input.length,
      bracketed ? 1 : 0,
      0,
      0,
      written
    )
    const outputSize = this.runtime.view(written, 4).getUint32(0, true)
    if (sizeResult === GHOSTTY_OUT_OF_SPACE && outputSize > 0) {
      const output = this.runtime.alloc(outputSize)
      const result = this.runtime.call(
        'ghostty_paste_encode',
        inputPointer,
        input.length,
        bracketed ? 1 : 0,
        output,
        outputSize,
        written
      )
      const outputLength = this.runtime.view(written, 4).getUint32(0, true)
      encoded = result === GHOSTTY_SUCCESS ? decoder.decode(this.runtime.bytes(output, outputLength)) : ''
      this.runtime.free(output, outputSize)
    }
    this.runtime.call('ghostty_wasm_free', written, 4)
    this.runtime.free(inputPointer, input.length)
    return encoded
  }

  encodeMouse(input: GhosttyMouseInput): string {
    this.ensureActive()
    this.runtime.call('ghostty_mouse_encoder_set_from_terminal', this.mouseEncoder, this.terminal)

    const sizeLayout = this.runtime.layout('GhosttyMouseEncoderSize')
    const size = this.runtime.alloc(sizeLayout.size)
    for (const [field, value] of [
      ['size', sizeLayout.size],
      ['screen_width', input.screenWidth],
      ['screen_height', input.screenHeight],
      ['cell_width', input.cellWidth],
      ['cell_height', input.cellHeight],
      ['padding_top', input.paddingTop],
      ['padding_bottom', input.paddingBottom],
      ['padding_right', input.paddingRight],
      ['padding_left', input.paddingLeft]
    ] as const) {
      this.runtime.setField(size, 'GhosttyMouseEncoderSize', field, Math.max(0, Math.round(value)))
    }
    this.runtime.call(
      'ghostty_mouse_encoder_set',
      this.mouseEncoder,
      this.runtime.enumValue('GhosttyMouseEncoderOption', 'SIZE'),
      size
    )
    this.runtime.free(size, sizeLayout.size)

    this.runtime.bytes(this.scratch, 1)[0] = input.anyButtonPressed ? 1 : 0
    this.runtime.call(
      'ghostty_mouse_encoder_set',
      this.mouseEncoder,
      this.runtime.enumValue('GhosttyMouseEncoderOption', 'ANY_BUTTON_PRESSED'),
      this.scratch
    )
    this.runtime.bytes(this.scratch, 1)[0] = 1
    this.runtime.call(
      'ghostty_mouse_encoder_set',
      this.mouseEncoder,
      this.runtime.enumValue('GhosttyMouseEncoderOption', 'TRACK_LAST_CELL'),
      this.scratch
    )

    this.runtime.call(
      'ghostty_mouse_event_set_action',
      this.mouseEvent,
      input.action === 'press' ? 0 : input.action === 'release' ? 1 : 2
    )
    if (input.button === null) {
      this.runtime.call('ghostty_mouse_event_clear_button', this.mouseEvent)
    } else {
      this.runtime.call('ghostty_mouse_event_set_button', this.mouseEvent, input.button)
    }
    this.runtime.call('ghostty_mouse_event_set_mods', this.mouseEvent, input.mods)
    const positionLayout = this.runtime.layout('GhosttyMousePosition')
    const position = this.runtime.alloc(positionLayout.size)
    const positionView = this.runtime.view(position, positionLayout.size)
    this.runtime.bytes(this.scratch, 1)[0] = 0
    const pixels = this.mode(1016)
    // The ABI uses integer cell sizes; preserve CSS cell coordinates across fractional font metrics.
    const coordinate = (value: number, cell: number, padding: number) =>
      pixels ? value : Math.round(padding) + ((value - padding) / cell) * Math.max(1, Math.round(cell))
    positionView.setFloat32(
      positionLayout.fields.x.offset,
      coordinate(input.x, input.cellWidth, input.paddingLeft),
      true
    )
    positionView.setFloat32(
      positionLayout.fields.y.offset,
      coordinate(input.y, input.cellHeight, input.paddingTop),
      true
    )
    this.runtime.call('ghostty_mouse_event_set_position', this.mouseEvent, position)
    this.runtime.free(position, positionLayout.size)

    const written = this.runtime.call('ghostty_wasm_alloc', 4)
    const encoded = this.encodeOutput(written, (output, outputSize) =>
      this.runtime.call('ghostty_mouse_encoder_encode', this.mouseEncoder, this.mouseEvent, output, outputSize, written)
    )
    this.runtime.call('ghostty_wasm_free', written, 4)
    return encoded
  }

  setSelection(anchor: GhosttyPointInput, end: GhosttyPointInput): void {
    this.ensureActive()
    const selectionLayout = this.runtime.layout('GhosttySelection')
    const gridRefSize = this.runtime.layout('GhosttyGridRef').size
    const selection = this.runtime.alloc(selectionLayout.size)
    let start = 0
    let endRef = 0
    try {
      start = this.gridRef(anchor.x, anchor.y, anchor.tag ?? 1)
      endRef = this.gridRef(end.x, end.y, end.tag ?? 1)
      const startField = selectionLayout.fields.start
      const endField = selectionLayout.fields.end
      this.runtime.bytes(selection + startField.offset, startField.size).set(this.runtime.bytes(start, startField.size))
      this.runtime.bytes(selection + endField.offset, endField.size).set(this.runtime.bytes(endRef, endField.size))
      this.runtime.call(
        'ghostty_terminal_set',
        this.terminal,
        this.runtime.enumValue('GhosttyTerminalOption', 'SELECTION'),
        selection
      )
    } finally {
      this.runtime.free(start, gridRefSize)
      this.runtime.free(endRef, gridRefSize)
      this.runtime.free(selection, selectionLayout.size)
    }
  }

  selectAll(): GhosttySelectionRange['screen'] | null {
    this.ensureActive()
    const layout = this.runtime.layout('GhosttySelection')
    const selection = this.runtime.alloc(layout.size)
    try {
      if (this.runtime.call('ghostty_terminal_select_all', this.terminal, selection) !== GHOSTTY_SUCCESS) {
        return null
      }
      const start = this.pointFromGridRef(selection + layout.fields.start.offset, 2)
      const end = this.pointFromGridRef(selection + layout.fields.end.offset, 2)
      if (!start || !end) return null
      this.runtime.call(
        'ghostty_terminal_set',
        this.terminal,
        this.runtime.enumValue('GhosttyTerminalOption', 'SELECTION'),
        selection
      )
      return { start, end }
    } finally {
      this.runtime.free(selection, layout.size)
    }
  }

  selectionRange(): GhosttySelectionRange['screen'] | null {
    this.ensureActive()
    const layout = this.runtime.layout('GhosttySelection')
    const selection = this.runtime.alloc(layout.size)
    try {
      if (this.runtime.call('ghostty_terminal_get', this.terminal, 31, selection) !== GHOSTTY_SUCCESS) {
        return null
      }
      const start = this.pointFromGridRef(selection + layout.fields.start.offset, 2)
      const end = this.pointFromGridRef(selection + layout.fields.end.offset, 2)
      return start && end ? { start, end } : null
    } finally {
      this.runtime.free(selection, layout.size)
    }
  }

  selectWord(col: number, row: number): GhosttySelectionRange | null {
    return this.selectAt('GhosttyTerminalSelectWordOptions', 'ghostty_terminal_select_word', col, row)
  }

  selectLine(col: number, row: number): GhosttySelectionRange | null {
    return this.selectAt('GhosttyTerminalSelectLineOptions', 'ghostty_terminal_select_line', col, row)
  }

  hyperlinkAt(col: number, row: number): string | null {
    this.ensureActive()
    const ref = this.gridRef(col, row)
    const written = this.runtime.call('ghostty_wasm_alloc', 4)
    const sizeResult = this.runtime.call('ghostty_grid_ref_hyperlink_uri', ref, 0, 0, written)
    const outputSize = this.runtime.view(written, 4).getUint32(0, true)
    let hyperlink: string | null = null
    if (sizeResult === GHOSTTY_OUT_OF_SPACE && outputSize > 0) {
      const output = this.runtime.alloc(outputSize)
      const result = this.runtime.call('ghostty_grid_ref_hyperlink_uri', ref, output, outputSize, written)
      const outputLength = this.runtime.view(written, 4).getUint32(0, true)
      if (result === GHOSTTY_SUCCESS && outputLength > 0) {
        hyperlink = decoder.decode(this.runtime.bytes(output, outputLength))
      }
      this.runtime.free(output, outputSize)
    }
    this.runtime.call('ghostty_wasm_free', written, 4)
    this.runtime.free(ref, this.runtime.layout('GhosttyGridRef').size)
    return hyperlink
  }

  clearSelection(): void {
    this.ensureActive()
    this.runtime.call(
      'ghostty_terminal_set',
      this.terminal,
      this.runtime.enumValue('GhosttyTerminalOption', 'SELECTION'),
      0
    )
  }

  snapshot(): GhosttySnapshot {
    this.ensureActive()
    this.assertSuccess(
      'ghostty_render_state_update',
      this.runtime.call('ghostty_render_state_update', this.renderState, this.terminal)
    )
    const cols = this.getU16(RENDER_DATA.cols)
    const rowCount = this.getU16(RENDER_DATA.rows)
    const dirty = this.getU32(RENDER_DATA.dirty)
    const foreground = this.getColor(RENDER_DATA.foreground, { r: 229, g: 231, b: 235 })
    const background = this.getColor(RENDER_DATA.background, { r: 0, g: 0, b: 0 })
    const cursorHasValue = this.getBool(RENDER_DATA.cursorHasValue)
    const cursor = cursorHasValue ? this.getColor(RENDER_DATA.cursor, foreground) : foreground
    const cursorInViewport = this.getBool(RENDER_DATA.cursorInViewport)
    const cursorVisible = this.getBool(RENDER_DATA.cursorVisible) && cursorInViewport
    const cursorX = cursorInViewport ? this.getU16(RENDER_DATA.cursorX) : -1
    const cursorY = cursorInViewport ? this.getU16(RENDER_DATA.cursorY) : -1

    if (this.rows.length !== rowCount || this.rows.some((row) => row.cells.length !== cols)) {
      this.rows = Array.from({ length: rowCount }, () => ({
        cells: Array.from({ length: cols }, () => this.emptyCell(foreground, background)),
        text: '',
        isWrapContinuation: false,
        wrapsToNext: false
      }))
    }

    const dirtyRows = new Set<number>()
    if (dirty !== 0) {
      this.assertSuccess(
        'ghostty_render_state_get(row iterator)',
        this.runtime.call('ghostty_render_state_get', this.renderState, RENDER_DATA.rowIterator, this.rowIteratorSlot)
      )
      const iterator = this.runtime.readPointer(this.rowIteratorSlot)
      let rowIndex = 0
      while (rowIndex < rowCount && this.runtime.call('ghostty_render_state_row_iterator_next', iterator) !== 0) {
        const rowDirty = dirty === 2 || this.getRowBool(iterator, ROW_DATA.dirty)
        if (rowDirty) {
          this.rows[rowIndex] = this.readRow(iterator, cols, foreground, background)
          dirtyRows.add(rowIndex)
          this.runtime.memoryBytes()[this.scratch] = 0
          this.runtime.call(
            'ghostty_render_state_row_set',
            iterator,
            this.runtime.enumValue('GhosttyRenderStateRowOption', 'DIRTY'),
            this.scratch
          )
        }
        rowIndex += 1
      }
      this.runtime.memoryDataView().setUint32(this.scratch, 0, true)
      this.runtime.call(
        'ghostty_render_state_set',
        this.renderState,
        this.runtime.enumValue('GhosttyRenderStateOption', 'DIRTY'),
        this.scratch
      )
    }

    return {
      cols,
      rows: rowCount,
      foreground,
      background,
      cursor,
      cursorX,
      cursorY,
      cursorVisible,
      cursorBlinking: this.getBool(RENDER_DATA.cursorBlinking),
      cursorStyle: this.getU32(RENDER_DATA.cursorStyle),
      dirtyRows,
      rowData: this.rows.slice()
    }
  }

  selectionText(): string {
    this.ensureActive()
    const selectionLayout = this.runtime.layout('GhosttySelection')
    const selection = this.runtime.alloc(selectionLayout.size)
    const slot = this.runtime.allocOpaque()
    let formatter = 0
    const written = this.runtime.alloc(4)
    try {
      if (
        this.runtime.call(
          'ghostty_terminal_get',
          this.terminal,
          this.runtime.enumValue('GhosttyTerminalData', 'SELECTION'),
          selection
        ) !== GHOSTTY_SUCCESS
      )
        return ''
      this.assertSuccess(
        'ghostty_formatter_terminal_new',
        this.runtime.call('ghostty_formatter_terminal_new', 0, slot, this.terminal)
      )
      formatter = this.runtime.readPointer(slot)
      this.assertSuccess(
        'ghostty_formatter_set(selection)',
        this.runtime.call(
          'ghostty_formatter_set',
          formatter,
          this.runtime.enumValue('GhosttyFormatterOption', 'SELECTION'),
          selection
        )
      )
      return this.encodeOutput(written, (output, size) =>
        this.runtime.call('ghostty_formatter_format_buf', formatter, output, size, written)
      )
    } finally {
      if (formatter) this.runtime.call('ghostty_formatter_free', formatter)
      this.runtime.free(written, 4)
      this.runtime.freeOpaque(slot)
      this.runtime.free(selection, selectionLayout.size)
    }
  }

  dimensions(): { cols: number; rows: number } {
    this.runtime.call(
      'ghostty_terminal_get',
      this.terminal,
      this.runtime.enumValue('GhosttyTerminalData', 'COLS'),
      this.scratch
    )
    const cols = this.runtime.view(this.scratch, 2).getUint16(0, true)
    this.runtime.call(
      'ghostty_terminal_get',
      this.terminal,
      this.runtime.enumValue('GhosttyTerminalData', 'ROWS'),
      this.scratch
    )
    return { cols, rows: this.runtime.view(this.scratch, 2).getUint16(0, true) }
  }

  cursorPoint(): { x: number; y: number } {
    const get = (name: string) => {
      this.assertSuccess(
        name,
        this.runtime.call(
          'ghostty_terminal_get',
          this.terminal,
          this.runtime.enumValue('GhosttyTerminalData', name),
          this.scratch
        )
      )
      return this.runtime.view(this.scratch, 2).getUint16(0, true)
    }
    const x = get('CURSOR_X')
    const y = get('CURSOR_Y')
    this.scrollToBottom()
    const origin = this.viewportPointToScreen(0, 0)
    return { x, y: y + (origin?.y ?? 0) }
  }

  track(id: string, position = this.cursorPoint()): void {
    this.dropAnchor(id)
    const layout = this.runtime.layout('GhosttyPoint')
    const point = this.runtime.alloc(layout.size)
    const slot = this.runtime.allocOpaque()
    try {
      this.runtime.setField(point, 'GhosttyPoint', 'tag', 2)
      const value = this.runtime.view(point + layout.fields.value.offset, layout.fields.value.size)
      value.setUint16(0, position.x, true)
      value.setUint32(4, position.y, true)
      this.assertSuccess(
        'ghostty_terminal_grid_ref_track',
        this.runtime.call('ghostty_terminal_grid_ref_track', this.terminal, point, slot)
      )
      this.anchors.set(id, this.runtime.readPointer(slot))
    } finally {
      this.runtime.freeOpaque(slot)
      this.runtime.free(point, layout.size)
    }
  }

  anchorPoint(id: string): { x: number; y: number } | null {
    const handle = this.anchors.get(id)
    if (!handle || !this.runtime.call('ghostty_tracked_grid_ref_has_value', handle)) return null
    if (this.runtime.call('ghostty_tracked_grid_ref_point', handle, 2, this.scratch) !== GHOSTTY_SUCCESS) return null
    const point = this.runtime.view(this.scratch, 8)
    return { x: point.getUint16(0, true), y: point.getUint32(4, true) }
  }

  dropAnchor(id: string): void {
    const handle = this.anchors.get(id)
    if (handle) this.runtime.call('ghostty_tracked_grid_ref_free', handle)
    this.anchors.delete(id)
  }

  /** Formats an explicit inclusive range without changing the terminal's selection. */
  formatRange(start: { x: number; y: number }, end: { x: number; y: number }, limit: number): string | null {
    this.ensureActive()
    const layout = this.runtime.layout('GhosttySelection')
    const selection = this.runtime.alloc(layout.size)
    this.runtime.bytes(selection, layout.size).fill(0)
    const slot = this.runtime.allocOpaque()
    const written = this.runtime.alloc(4)
    const output = this.runtime.alloc(limit)
    let formatter = 0
    let first = 0
    let last = 0
    try {
      first = this.gridRef(start.x, start.y, 2)
      last = this.gridRef(end.x, end.y, 2)
      this.runtime
        .bytes(selection + layout.fields.start.offset, layout.fields.start.size)
        .set(this.runtime.bytes(first, layout.fields.start.size))
      this.runtime
        .bytes(selection + layout.fields.end.offset, layout.fields.end.size)
        .set(this.runtime.bytes(last, layout.fields.end.size))
      this.assertSuccess(
        'ghostty_formatter_terminal_new',
        this.runtime.call('ghostty_formatter_terminal_new', 0, slot, this.terminal)
      )
      formatter = this.runtime.readPointer(slot)
      this.runtime.bytes(written, 1)[0] = 1
      this.assertSuccess(
        'ghostty_formatter_set(unwrap)',
        this.runtime.call(
          'ghostty_formatter_set',
          formatter,
          this.runtime.enumValue('GhosttyFormatterOption', 'UNWRAP'),
          written
        )
      )
      this.assertSuccess(
        'ghostty_formatter_set',
        this.runtime.call(
          'ghostty_formatter_set',
          formatter,
          this.runtime.enumValue('GhosttyFormatterOption', 'SELECTION'),
          selection
        )
      )
      const result = this.runtime.call('ghostty_formatter_format_buf', formatter, output, limit, written)
      if (result === GHOSTTY_OUT_OF_SPACE) return null
      this.assertSuccess('ghostty_formatter_format_buf', result)
      return decoder.decode(this.runtime.bytes(output, this.runtime.view(written, 4).getUint32(0, true)))
    } finally {
      if (formatter) this.runtime.call('ghostty_formatter_free', formatter)
      if (first) this.runtime.free(first, this.runtime.layout('GhosttyGridRef').size)
      if (last) this.runtime.free(last, this.runtime.layout('GhosttyGridRef').size)
      this.runtime.free(output, limit)
      this.runtime.free(written, 4)
      this.runtime.freeOpaque(slot)
      this.runtime.free(selection, layout.size)
    }
  }

  /** Reads bounded source rows; the caller restores its viewport in the same turn. */
  sourceRows(start: number, count: number): GhosttyRow[] {
    this.scrollToBottom()
    const bottom = this.scrollbarState()
    if (!bottom) return []
    this.scroll(start - bottom.offset)
    const actual = this.scrollbarState()?.offset ?? 0
    return this.snapshot().rowData.slice(start - actual, start - actual + count)
  }

  openSnapshotSearch(id: string): void {
    this.closeSearch(id)
    const budget = this.runtime.createBudget(4 * 1024 * 1024)
    try {
      this.runtime.reserveBudget(budget, 512 * 1024)
      this.searches.set(id, { handle: 0, slot: 0, budget })
    } catch (error) {
      this.runtime.releaseBudget(budget)
      throw error
    }
  }

  openSearch(id: string, needle: string, limit = 4 * 1024 * 1024): void {
    this.ensureActive()
    this.closeSearch(id)
    const text = encoder.encode(needle)
    if (text.length === 0 || text.length > 4096) throw new Error('Invalid terminal search needle')
    const budget = this.runtime.createBudget(Math.min(limit, 4 * 1024 * 1024))
    let slot = 0
    let value = 0
    let handle = 0
    let accepted = false
    try {
      // Pinned Ghostty keeps only scan/selected pins in terminal pools; results use this allocator.
      this.runtime.reserveBudget(budget, 64 * 1024)
      slot = this.runtime.allocBudget(budget, 4)
      value = this.runtime.allocBudget(budget, 8 + text.length)
      this.runtime.bytes(value + 8, text.length).set(text)
      const view = this.runtime.view(value, 8)
      view.setUint32(0, value + 8, true)
      view.setUint32(4, text.length, true)
      this.searchResult(this.runtime.call('ghostty_search_new', budget.pointer, slot, this.terminal), budget)
      handle = this.runtime.readPointer(slot)
      this.runtime.view(this.scratch, 4).setInt32(0, this.runtime.enumValue('GhosttySearchScroll', 'NONE'), true)
      this.searchResult(
        this.runtime.call(
          'ghostty_search_set',
          handle,
          this.runtime.enumValue('GhosttySearchOption', 'SELECT_SCROLL'),
          this.scratch
        ),
        budget
      )
      this.searchResult(
        this.runtime.call('ghostty_search_set', handle, this.runtime.enumValue('GhosttySearchOption', 'NEEDLE'), value),
        budget
      )
      this.searches.set(id, { handle, slot, budget })
      accepted = true
    } finally {
      this.runtime.freeBudget(budget, value)
      if (!accepted) {
        if (handle) this.runtime.call('ghostty_search_free', handle)
        this.runtime.freeBudget(budget, slot)
        this.runtime.releaseBudget(budget)
      }
    }
  }

  advanceSearch(id: string, feed: boolean): GhosttySearchProjection {
    this.ensureActive()
    const search = this.searches.get(id)
    if (!search) throw new Error('Terminal search is unavailable')
    try {
      if (feed) this.searchResult(this.runtime.call('ghostty_search_feed', search.handle), search.budget)
      for (let tick = 0; tick < 4; tick++) {
        this.searchResult(this.runtime.call('ghostty_search_tick', search.handle, this.scratch), search.budget)
        if (this.runtime.view(this.scratch, 4).getInt32(0, true) !== 0) break
      }
      return this.searchProjection(search)
    } catch (error) {
      this.closeSearch(id)
      throw error
    }
  }

  navigateSearch(id: string, direction: 'next' | 'previous'): GhosttySearchProjection {
    this.ensureActive()
    const search = this.searches.get(id)
    if (!search) throw new Error('Terminal search is unavailable')
    try {
      const result = this.runtime.call(
        direction === 'next' ? 'ghostty_search_select_next' : 'ghostty_search_select_prev',
        search.handle
      )
      if (result !== -4) this.searchResult(result, search.budget)
      return this.searchProjection(search)
    } catch (error) {
      this.closeSearch(id)
      throw error
    }
  }

  closeSearch(id: string): void {
    const search = this.searches.get(id)
    if (!search) return
    this.searches.delete(id)
    if (search.handle) this.runtime.call('ghostty_search_free', search.handle)
    this.runtime.freeBudget(search.budget, search.slot)
    this.runtime.releaseBudget(search.budget)
  }

  private searchResult(result: number, budget: GhosttyAllocationBudget): void {
    if (budget.exhausted || result === -1) throw new GhosttySearchCapacityError()
    this.assertSuccess('ghostty_search', result)
  }

  private searchProjection(search: { handle: number; budget: GhosttyAllocationBudget }): GhosttySearchProjection {
    const { handle, budget } = search
    const get = (key: string, pointer: number) =>
      this.runtime.call('ghostty_search_get', handle, this.runtime.enumValue('GhosttySearchData', key), pointer)
    this.searchResult(get('STATUS', this.scratch), budget)
    const status = this.runtime.view(this.scratch, 4).getInt32(0, true)
    this.searchResult(get('TOTAL_MATCHES', this.scratch), budget)
    const count = this.runtime.view(this.scratch, 4).getUint32(0, true)
    let selected: GhosttySearchProjection['selected'] = null
    const selectionSize = this.runtime.layout('GhosttySelection').size
    const value = this.runtime.allocBudget(budget, selectionSize)
    try {
      if (get('SELECTED_INDEX', this.scratch) === GHOSTTY_SUCCESS) {
        const index = this.runtime.view(this.scratch, 4).getUint32(0, true)
        if (get('SELECTED_MATCH', value) === GHOSTTY_SUCCESS) {
          const range = this.selectionCoordinates(value)
          if (range) selected = { index, range }
        }
      }
      const bufferLayout = this.runtime.layout('GhosttySelectionBuffer')
      const buffer = this.runtime.allocBudget(budget, bufferLayout.size)
      try {
        const result = get('VIEWPORT_MATCHES', buffer)
        if (result !== GHOSTTY_OUT_OF_SPACE) this.searchResult(result, budget)
        const length = this.runtime.view(buffer, bufferLayout.size).getUint32(bufferLayout.fields.len.offset, true)
        if (length > 2000)
          return {
            status: status === 2 ? 'complete' : status === 1 ? 'feed-required' : 'running',
            count,
            selected,
            matches: [],
            highlightsLimited: true
          }
        const matches: GhosttySearchProjection['matches'] = []
        if (length) {
          const storage = this.runtime.allocBudget(budget, length * selectionSize)
          try {
            this.runtime.view(buffer, bufferLayout.size).setUint32(bufferLayout.fields.ptr.offset, storage, true)
            this.runtime.view(buffer, bufferLayout.size).setUint32(bufferLayout.fields.cap.offset, length, true)
            this.searchResult(get('VIEWPORT_MATCHES', buffer), budget)
            for (let index = 0; index < length; index++) {
              const range = this.selectionCoordinates(storage + index * selectionSize)
              if (range) matches.push(range)
            }
          } finally {
            this.runtime.freeBudget(budget, storage)
          }
        }
        return {
          status: status === 2 ? 'complete' : status === 1 ? 'feed-required' : 'running',
          count,
          selected,
          matches,
          highlightsLimited: false
        }
      } finally {
        this.runtime.freeBudget(budget, buffer)
      }
    } finally {
      this.runtime.freeBudget(budget, value)
    }
  }

  private selectionCoordinates(pointer: number): GhosttySelectionRange['screen'] | null {
    const fields = this.runtime.layout('GhosttySelection').fields
    const start = this.pointFromGridRef(pointer + fields.start.offset, 2)
    const end = this.pointFromGridRef(pointer + fields.end.offset, 2)
    return start && end ? { start, end } : null
  }

  viewportPointToScreen(col: number, row: number): { x: number; y: number } | null {
    return this.convertPoint(col, row, 1, 2)
  }

  screenPointToViewport(col: number, row: number): { x: number; y: number } | null {
    return this.convertPoint(col, row, 2, 1)
  }

  private convertPoint(col: number, row: number, fromTag: 1 | 2, toTag: 1 | 2): { x: number; y: number } | null {
    this.ensureActive()
    const ref = this.gridRef(col, row, fromTag)
    const point = this.pointFromGridRef(ref, toTag)
    this.runtime.free(ref, this.runtime.layout('GhosttyGridRef').size)
    return point
  }

  dispose(): void {
    if (this.disposed) return
    for (const id of this.searches.keys()) this.closeSearch(id)
    for (const id of this.anchors.keys()) this.dropAnchor(id)
    this.disposed = true
    if (this.mouseEvent) this.runtime.call('ghostty_mouse_event_free', this.mouseEvent)
    if (this.mouseEncoder) this.runtime.call('ghostty_mouse_encoder_free', this.mouseEncoder)
    if (this.keyEvent) this.runtime.call('ghostty_key_event_free', this.keyEvent)
    if (this.keyEncoder) this.runtime.call('ghostty_key_encoder_free', this.keyEncoder)
    if (this.rowCellsSlot) {
      const cells = this.runtime.readPointer(this.rowCellsSlot)
      if (cells) this.runtime.call('ghostty_render_state_row_cells_free', cells)
    }
    if (this.rowIteratorSlot) {
      const iterator = this.runtime.readPointer(this.rowIteratorSlot)
      if (iterator) this.runtime.call('ghostty_render_state_row_iterator_free', iterator)
    }
    if (this.renderState) this.runtime.call('ghostty_render_state_free', this.renderState)
    if (this.terminal) {
      if (this.ptyWriterId) this.runtime.detachPtyWriter(this.terminal, this.ptyWriterId)
      this.runtime.call('ghostty_terminal_free', this.terminal)
    }
    if (this.style) this.runtime.free(this.style, this.runtime.layout('GhosttyStyle').size)
    if (this.cellQuery) this.runtime.free(this.cellQuery, CELL_QUERY.size)
    if (this.scrollbar) {
      this.runtime.free(this.scrollbar, this.runtime.layout('GhosttyTerminalScrollbar').size)
    }
    if (this.scratch) this.runtime.free(this.scratch, 16)
    if (this.graphemes) this.runtime.free(this.graphemes, this.graphemeCapacity)
    for (const slot of [
      this.mouseEventSlot,
      this.mouseEncoderSlot,
      this.keyEventSlot,
      this.keyEncoderSlot,
      this.rowCellsSlot,
      this.rowIteratorSlot,
      this.renderStateSlot,
      this.terminalSlot
    ]) {
      this.runtime.freeOpaque(slot)
    }
  }

  private encodeOutput(written: number, encode: (output: number, outputSize: number) => number): string {
    const sizeResult = encode(0, 0)
    const outputSize = this.runtime.view(written, 4).getUint32(0, true)
    if (sizeResult === GHOSTTY_SUCCESS && outputSize === 0) return ''
    if (sizeResult !== GHOSTTY_OUT_OF_SPACE || outputSize === 0) return ''

    const output = this.runtime.alloc(outputSize)
    const result = encode(output, outputSize)
    const outputLength = this.runtime.view(written, 4).getUint32(0, true)
    const encoded = result === GHOSTTY_SUCCESS ? decoder.decode(this.runtime.bytes(output, outputLength)) : ''
    this.runtime.free(output, outputSize)
    return encoded
  }

  private readRow(
    iterator: number,
    cols: number,
    defaultForeground: GhosttyColor,
    defaultBackground: GhosttyColor
  ): GhosttyRow {
    this.assertSuccess(
      'ghostty_render_state_row_get(raw)',
      this.runtime.call('ghostty_render_state_row_get', iterator, ROW_DATA.raw, this.scratch)
    )
    const rawRow = this.runtime.memoryDataView().getBigUint64(this.scratch, true)
    this.runtime.memoryBytes()[this.scratch + 8] = 0
    this.assertSuccess(
      'ghostty_row_get(wrap continuation)',
      this.runtime.call('ghostty_row_get', rawRow, 2, this.scratch + 8)
    )
    const isWrapContinuation = this.runtime.memoryBytes()[this.scratch + 8] !== 0
    this.runtime.memoryBytes()[this.scratch + 8] = 0
    this.assertSuccess('ghostty_row_get(wrap)', this.runtime.call('ghostty_row_get', rawRow, 1, this.scratch + 8))
    const wrapsToNext = this.runtime.memoryBytes()[this.scratch + 8] !== 0

    this.assertSuccess(
      'ghostty_render_state_row_get(cells)',
      this.runtime.call('ghostty_render_state_row_get', iterator, ROW_DATA.cells, this.rowCellsSlot)
    )
    const cellsIterator = this.runtime.readPointer(this.rowCellsSlot)
    const { size: styleSize, fields: styleFields } = this.runtime.layout('GhosttyStyle')
    const codepointBuffer = this.runtime.layout('GhosttyCodepointBuffer')
    const cellsNext = this.runtime.fn('ghostty_render_state_row_cells_next')
    const cellsGetMulti = this.runtime.fn('ghostty_render_state_row_cells_get_multi')
    const cells: GhosttyCell[] = []
    while (cells.length < cols && cellsNext(cellsIterator) !== 0) {
      this.runtime.memoryBytes().fill(0, this.style, this.style + styleSize)
      const result = cellsGetMulti(
        cellsIterator,
        5,
        this.cellQuery + CELL_QUERY.keys,
        this.cellQuery + CELL_QUERY.values,
        this.cellQuery + CELL_QUERY.written
      )
      const queryView = this.runtime.memoryDataView()
      const written = queryView.getUint32(this.cellQuery + CELL_QUERY.written, true)
      if (written < 3) this.assertSuccess('ghostty_render_state_row_cells_get_multi', result)
      const graphemeLength = queryView.getUint32(this.cellQuery + CELL_QUERY.graphemesLength, true)
      const selected = queryView.getUint8(this.cellQuery + CELL_QUERY.selected) !== 0
      let background = written >= 4 ? this.readColor(this.cellQuery + CELL_QUERY.background) : defaultBackground
      let foreground =
        written === 5
          ? this.readColor(this.cellQuery + CELL_QUERY.foreground)
          : written === 3
            ? this.getCellColor(cellsIterator, CELL_DATA.foreground, defaultForeground)
            : defaultForeground
      let text = ''
      if (graphemeLength > 0) {
        const bufferSize = graphemeLength * 4
        if (bufferSize > this.graphemeCapacity) {
          const capacity = Math.max(bufferSize, this.graphemeCapacity * 2)
          const buffer = this.runtime.alloc(capacity)
          this.runtime.free(this.graphemes, this.graphemeCapacity)
          this.graphemes = buffer
          this.graphemeCapacity = capacity
        }
        const buffer = this.runtime.view(this.scratch, codepointBuffer.size)
        buffer.setUint32(codepointBuffer.fields.ptr.offset, this.graphemes, true)
        buffer.setUint32(codepointBuffer.fields.cap.offset, this.graphemeCapacity / 4, true)
        buffer.setUint32(codepointBuffer.fields.len.offset, 0, true)
        if (
          this.runtime.call('ghostty_render_state_row_cells_get', cellsIterator, CELL_DATA.graphemes, this.scratch) ===
          GHOSTTY_SUCCESS
        ) {
          // Byte allocations need not be 4-byte aligned; use DataView instead of Uint32Array.
          text = ghosttyCellText(this.runtime.memoryDataView(), graphemeLength, this.graphemes)
        }
      }
      let wide = 0
      // A wrap spacer in the final column can follow a spacer tail.
      if (text.length === 0 && (cells.at(-1)?.text.length || cells.length === cols - 1)) {
        this.assertSuccess(
          'ghostty_render_state_row_cells_get(raw)',
          this.runtime.call('ghostty_render_state_row_cells_get', cellsIterator, CELL_DATA.raw, this.scratch)
        )
        const rawCell = this.runtime.memoryDataView().getBigUint64(this.scratch, true)
        this.runtime.memoryDataView().setUint32(this.scratch + 8, 0, true)
        this.assertSuccess(
          'ghostty_cell_get(wide)',
          this.runtime.call('ghostty_cell_get', rawCell, RAW_CELL_DATA.wide, this.scratch + 8)
        )
        wide = this.runtime.memoryDataView().getUint32(this.scratch + 8, true)
      }
      // Read the style after allocation and ABI calls, which can grow WASM memory.
      const styleView = this.runtime.memoryDataView()
      const flags = styleView.getUint16(this.style + styleFields.flags.offset, true)
      if ((flags & (1 << 4)) !== 0) {
        ;[foreground, background] = [background, foreground]
      }
      if ((flags & (1 << 2)) !== 0) {
        foreground = blend(foreground, background)
      }
      cells.push({
        text,
        wide,
        foreground,
        background,
        bold: (flags & (1 << 0)) !== 0,
        italic: (flags & (1 << 1)) !== 0,
        invisible: (flags & (1 << 5)) !== 0,
        strikethrough: (flags & (1 << 6)) !== 0,
        overline: (flags & (1 << 7)) !== 0,
        underline: (flags & (7 << 8)) !== 0,
        selected
      })
    }
    while (cells.length < cols) cells.push(this.emptyCell(defaultForeground, defaultBackground))
    return {
      cells,
      text: cells
        .filter((cell) => cell.wide !== GHOSTTY_CELL_WIDE.spacerTail && cell.wide !== GHOSTTY_CELL_WIDE.spacerHead)
        .map((cell) => cell.text || ' ')
        .join('')
        .trimEnd(),
      isWrapContinuation,
      wrapsToNext
    }
  }

  private gridRef(col: number, row: number, tag: 1 | 2 = 1): number {
    const pointLayout = this.runtime.layout('GhosttyPoint')
    const point = this.runtime.alloc(pointLayout.size)
    this.runtime.setField(point, 'GhosttyPoint', 'tag', tag)
    const pointValue = pointLayout.fields.value
    const valueOffset = pointValue.offset
    const view = this.runtime.view(point + valueOffset, pointValue.size)
    view.setUint16(0, Math.max(0, col), true)
    view.setUint32(4, Math.max(0, row), true)
    const gridRefSize = this.runtime.layout('GhosttyGridRef').size
    const gridRef = this.runtime.alloc(gridRefSize)
    const result = this.runtime.call('ghostty_terminal_grid_ref', this.terminal, point, gridRef)
    this.runtime.free(point, pointLayout.size)
    if (result !== GHOSTTY_SUCCESS) {
      this.runtime.free(gridRef, gridRefSize)
      this.assertSuccess('ghostty_terminal_grid_ref', result)
    }
    return gridRef
  }

  private selectAt(
    optionsName: 'GhosttyTerminalSelectWordOptions' | 'GhosttyTerminalSelectLineOptions',
    operation: 'ghostty_terminal_select_word' | 'ghostty_terminal_select_line',
    col: number,
    row: number
  ): GhosttySelectionRange | null {
    this.ensureActive()
    const optionsLayout = this.runtime.layout(optionsName)
    const selectionLayout = this.runtime.layout('GhosttySelection')
    const options = this.runtime.alloc(optionsLayout.size)
    let ref = 0
    let selection = 0
    let range: GhosttySelectionRange | null = null
    try {
      this.runtime.setField(options, optionsName, 'size', optionsLayout.size)
      ref = this.gridRef(col, row)
      const refField = optionsLayout.fields.ref
      this.runtime.bytes(options + refField.offset, refField.size).set(this.runtime.bytes(ref, refField.size))
      selection = this.runtime.alloc(selectionLayout.size)
      const result = this.runtime.call(operation, this.terminal, options, selection)
      if (result === GHOSTTY_SUCCESS) {
        const start = selection + selectionLayout.fields.start.offset
        const end = selection + selectionLayout.fields.end.offset
        const viewportStart = this.pointFromGridRef(start, 1)
        const viewportEnd = this.pointFromGridRef(end, 1)
        const screenStart = this.pointFromGridRef(start, 2)
        const screenEnd = this.pointFromGridRef(end, 2)
        if (viewportStart && viewportEnd && screenStart && screenEnd) {
          range = {
            viewport: { start: viewportStart, end: viewportEnd },
            screen: { start: screenStart, end: screenEnd }
          }
        }
        this.runtime.call(
          'ghostty_terminal_set',
          this.terminal,
          this.runtime.enumValue('GhosttyTerminalOption', 'SELECTION'),
          selection
        )
      }
    } finally {
      this.runtime.free(selection, selectionLayout.size)
      this.runtime.free(ref, this.runtime.layout('GhosttyGridRef').size)
      this.runtime.free(options, optionsLayout.size)
    }
    return range
  }

  private pointFromGridRef(ref: number, tag: 1 | 2): { x: number; y: number } | null {
    const coordinateLayout = this.runtime.layout('GhosttyPointCoordinate')
    const coordinate = this.runtime.alloc(coordinateLayout.size)
    const result = this.runtime.call('ghostty_terminal_point_from_grid_ref', this.terminal, ref, tag, coordinate)
    const point =
      result === GHOSTTY_SUCCESS
        ? {
            x: this.runtime.readField(coordinate, 'GhosttyPointCoordinate', 'x'),
            y: this.runtime.readField(coordinate, 'GhosttyPointCoordinate', 'y')
          }
        : null
    this.runtime.free(coordinate, coordinateLayout.size)
    return point
  }

  private getU16(data: number): number {
    this.runtime.memoryDataView().setUint16(this.scratch, 0, true)
    this.assertSuccess(
      'ghostty_render_state_get',
      this.runtime.call('ghostty_render_state_get', this.renderState, data, this.scratch)
    )
    return this.runtime.memoryDataView().getUint16(this.scratch, true)
  }

  private getU32(data: number): number {
    this.runtime.memoryDataView().setUint32(this.scratch, 0, true)
    this.assertSuccess(
      'ghostty_render_state_get',
      this.runtime.call('ghostty_render_state_get', this.renderState, data, this.scratch)
    )
    return this.runtime.memoryDataView().getUint32(this.scratch, true)
  }

  private getBool(data: number): boolean {
    this.runtime.memoryBytes()[this.scratch] = 0
    this.assertSuccess(
      'ghostty_render_state_get',
      this.runtime.call('ghostty_render_state_get', this.renderState, data, this.scratch)
    )
    return this.runtime.memoryBytes()[this.scratch] !== 0
  }

  private getColor(data: number, fallback: GhosttyColor): GhosttyColor {
    this.runtime.memoryBytes().fill(0, this.scratch, this.scratch + 3)
    const result = this.runtime.call('ghostty_render_state_get', this.renderState, data, this.scratch)
    return result === GHOSTTY_SUCCESS ? this.readColor(this.scratch) : fallback
  }

  private getRowBool(iterator: number, data: number): boolean {
    this.runtime.memoryBytes()[this.scratch] = 0
    return (
      this.runtime.call('ghostty_render_state_row_get', iterator, data, this.scratch) === GHOSTTY_SUCCESS &&
      this.runtime.memoryBytes()[this.scratch] !== 0
    )
  }

  private getCellColor(iterator: number, data: number, fallback: GhosttyColor): GhosttyColor {
    this.runtime.memoryBytes().fill(0, this.scratch, this.scratch + 3)
    const result = this.runtime.call('ghostty_render_state_row_cells_get', iterator, data, this.scratch)
    return result === GHOSTTY_SUCCESS ? this.readColor(this.scratch) : fallback
  }

  private readColor(pointer: number): GhosttyColor {
    const view = this.runtime.memoryDataView()
    return {
      r: view.getUint8(pointer),
      g: view.getUint8(pointer + 1),
      b: view.getUint8(pointer + 2)
    }
  }

  private emptyCell(foreground: GhosttyColor, background: GhosttyColor): GhosttyCell {
    return {
      text: '',
      wide: 0,
      foreground,
      background,
      bold: false,
      italic: false,
      invisible: false,
      strikethrough: false,
      overline: false,
      underline: false,
      selected: false
    }
  }

  private assertSuccess(operation: string, result: number): void {
    if (result !== GHOSTTY_SUCCESS) throw new Error(`${operation} failed with result ${result}`)
  }

  private ensureActive(): void {
    if (this.disposed) throw new Error('libghostty-vt terminal has been disposed')
  }
}

export function ghosttyColorsEqual(left: GhosttyColor, right: GhosttyColor): boolean {
  return sameColor(left, right)
}
