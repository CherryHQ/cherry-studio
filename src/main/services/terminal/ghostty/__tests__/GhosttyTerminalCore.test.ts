import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { afterEach, beforeAll, describe, expect, it } from 'vitest'

import manifest from '../../../../../../resources/terminal/ghostty/manifest.json'
import { GhosttyRuntime, type GhosttyRuntimeOptions } from '../GhosttyRuntime'
import {
  GHOSTTY_CELL_WIDE,
  GhosttySearchCapacityError,
  GhosttyTerminalCore,
  type GhosttySnapshot
} from '../GhosttyTerminalCore'

let assets: GhosttyRuntimeOptions
let runtime: GhosttyRuntime
const terminals: GhosttyTerminalCore[] = []
const theme = {
  foreground: { r: 255, g: 255, b: 255 },
  background: { r: 0, g: 0, b: 0 },
  cursor: { r: 255, g: 255, b: 255 }
}
const arrowUp = { key: 78, mods: 0, consumedMods: 0, composing: false, unshiftedCodepoint: 0, text: '', repeat: false }

beforeAll(async () => {
  const assetDir = path.resolve(__dirname, '../../../../../../resources/terminal/ghostty')
  const [wasm, writePtyWasm] = await Promise.all(
    ['ghostty-vt.wasm', 'ghostty-write-pty.wasm'].map((file) => readFile(path.join(assetDir, file)))
  )
  assets = {
    wasm: Uint8Array.from(wasm),
    writePtyWasm: Uint8Array.from(writePtyWasm),
    revision: manifest.ghosttyRevision,
    onLog: () => {}
  }
  runtime = await GhosttyRuntime.create(assets)
})

afterEach(() => {
  for (const terminal of terminals.splice(0)) terminal.dispose()
})

function terminal(onPtyData: (data: string) => void = () => {}, owner = runtime) {
  const core = GhosttyTerminalCore.create({
    runtime: owner,
    cols: 20,
    rows: 4,
    cellWidth: 8,
    cellHeight: 16,
    scrollbackBytes: 8 * 1024 * 1024,
    theme,
    onPtyData
  })
  terminals.push(core)
  return core
}

function rowText(screen: GhosttySnapshot, row: number) {
  return screen.rowData[row].text
}

describe('headless Ghostty engine', () => {
  it('rejects an engine missing a required search entry before creating a terminal', async () => {
    const wasm = Buffer.from(assets.wasm)
    const symbol = Buffer.from('ghostty_search_tick')
    const offset = wasm.indexOf(symbol)
    expect(offset).toBeGreaterThan(0)
    Buffer.from('ghostty_search_xxxx').copy(wasm, offset)
    await expect(GhosttyRuntime.create({ ...assets, wasm: Uint8Array.from(wasm) })).rejects.toThrow(
      'ghostty_search_tick'
    )
  })

  it('searches retained history incrementally without changing viewport or interactive selection', () => {
    const core = terminal()
    core.write('first ERROR\r\nsecond\r\nthird error\r\nfourth\r\nfifth')
    core.setSelection({ x: 0, y: 0 }, { x: 5, y: 0 })
    const selection = core.selectionText()
    const before = core.scrollbarState()
    core.openSearch('find', 'error')
    let result = core.advanceSearch('find', true)
    for (let step = 0; result.status !== 'complete' && step < 30; step++)
      result = core.advanceSearch('find', result.status === 'feed-required')
    expect(result).toMatchObject({ status: 'complete', count: 2 })
    const newest = core.navigateSearch('find', 'next')
    const oldest = core.navigateSearch('find', 'next')
    expect(newest.selected?.index).toBe(0)
    expect(oldest.selected?.index).toBe(1)
    expect(newest.selected?.range.start.y).toBeGreaterThan(oldest.selected?.range.start.y ?? -1)
    expect(core.selectionText()).toBe(selection)
    expect(core.scrollbarState()).toEqual(before)
    core.write('\r\nnew ERROR')
    result = core.advanceSearch('find', true)
    for (let step = 0; result.status !== 'complete' && step < 30; step++)
      result = core.advanceSearch('find', result.status === 'feed-required')
    expect(result).toMatchObject({ status: 'complete', count: 3 })
    core.closeSearch('find')
    core.closeSearch('find')
  })

  it('recovers from native search budget exhaustion without losing either terminal', () => {
    const core = terminal()
    const sibling = terminal()
    core.write('a'.repeat(300_000))
    expect(() => {
      core.openSearch('limited', 'a', 64 * 1024)
      for (let step = 0; step < 1000; step++) core.advanceSearch('limited', true)
    }).toThrow(GhosttySearchCapacityError)
    sibling.write('sibling remains usable')
    expect(
      sibling
        .snapshot()
        .rowData.map((row) => row.text)
        .join('')
    ).toContain('sibling remains usable')
    core.write('\r\nrecovered')
    expect(
      core
        .snapshot()
        .rowData.map((row) => row.text)
        .join('\n')
    ).toContain('recovered')
    core.openSearch('fresh', 'recovered')
    expect(core.advanceSearch('fresh', true).count).toBe(1)
  })

  it('frees a searched core without invalidating its sibling search', () => {
    const first = terminal()
    const second = terminal()
    first.write('one')
    second.write('two')
    first.openSearch('one', 'one')
    second.openSearch('two', 'two')
    first.advanceSearch('one', true)
    first.dispose()
    expect(second.advanceSearch('two', true).count).toBe(1)
    second.write('\r\ntwo')
    expect(second.advanceSearch('two', true).count).toBe(2)
  })

  it('bounds aggregate search allocations and makes released capacity reusable', () => {
    const budgets = Array.from({ length: 4 }, () => runtime.createBudget(4 * 1024 * 1024))
    const last = runtime.createBudget(4 * 1024 * 1024)
    try {
      for (const budget of budgets) runtime.allocBudget(budget, 3 * 1024 * 1024)
      expect(() => runtime.allocBudget(last, 4 * 1024 * 1024 - last.size)).toThrow(GhosttySearchCapacityError)
    } finally {
      for (const budget of [...budgets, last]) runtime.releaseBudget(budget)
    }
    const recovered = runtime.createBudget(4 * 1024 * 1024)
    try {
      const pointer = runtime.allocBudget(recovered, 3 * 1024 * 1024)
      runtime.bytes(pointer, 3)[0] = 42
      expect(runtime.bytes(pointer, 3)[0]).toBe(42)
    } finally {
      runtime.releaseBudget(recovered)
    }
  })

  it('keeps screen search results separate and refreshes coordinates after reflow', () => {
    const core = terminal()
    core.write('primary match')
    core.openSearch('screens', 'match')
    expect(core.advanceSearch('screens', true).count).toBe(1)
    core.write('\x1b[?1049h\x1b[HALT match match')
    expect(core.advanceSearch('screens', true).count).toBe(2)
    core.write('\x1b[?1049l')
    expect(core.advanceSearch('screens', true).count).toBe(1)
    core.resize(8, 4, 8, 16)
    const refreshed = core.advanceSearch('screens', true)
    expect(refreshed.count).toBe(1)
    const selected = core.navigateSearch('screens', 'next').selected
    expect(selected?.range).toEqual({ start: { x: 0, y: 1 }, end: { x: 4, y: 1 } })
  })

  it('loads the pinned assets and rejects an ABI source revision mismatch', async () => {
    expect(createHash('sha256').update(assets.wasm).digest('hex')).toBe(manifest.sha256['ghostty-vt.wasm'])
    expect(createHash('sha256').update(assets.writePtyWasm).digest('hex')).toBe(
      manifest.sha256['ghostty-write-pty.wasm']
    )
    await expect(GhosttyRuntime.create({ ...assets, revision: 'wrong-revision' })).rejects.toThrow('revision mismatch')
  })

  it('parses split UTF-8 and VT sequences into Unicode cells and styles without DOM', () => {
    const core = terminal()
    const bytes = new TextEncoder().encode('A世界e\u0301')
    core.write(bytes.subarray(0, 3))
    core.write(bytes.subarray(3))
    core.write('\r\n\x1b[')
    core.write('1;38;2;10;20;30mB\x1b[0m')
    const screen = core.snapshot()
    expect(rowText(screen, 0)).toBe('A世界e\u0301')
    expect(screen.rowData[0].cells.filter((cell) => cell.wide === GHOSTTY_CELL_WIDE.spacerTail)).toHaveLength(2)
    expect(screen.rowData[1].cells[0]).toMatchObject({ text: 'B', bold: true, foreground: { r: 10, g: 20, b: 30 } })
  })

  it('answers terminal queries immediately and routes replies only to their owning terminal', () => {
    const firstReplies: string[] = []
    const secondReplies: string[] = []
    const first = terminal((data) => firstReplies.push(data))
    const second = terminal((data) => secondReplies.push(data))
    first.write('hello\r\n世界\x1b[6n')
    second.write('\x1b[5n')
    expect(firstReplies).toEqual(['\x1b[2;5R'])
    expect(secondReplies).toEqual(['\x1b[0n'])
    first.dispose()
    second.write('\x1b[6n')
    expect(secondReplies).toEqual(['\x1b[0n', '\x1b[1;1R'])
    expect(() => first.write('stale')).toThrow('disposed')
  })

  it('encodes keys and paste using current terminal modes', () => {
    const core = terminal()
    expect(core.encodeKey(arrowUp)).toBe('\x1b[A')
    expect(core.encodePaste('中文\nx')).toBe('中文\rx')
    core.write('\x1b[?1h\x1b[?2004h')
    expect(core.encodeKey(arrowUp)).toBe('\x1bOA')
    expect(core.encodePaste('中文\nx')).toBe('\x1b[200~中文\nx\x1b[201~')
  })

  it('updates cursor defaults live and restores them after an application resets its cursor', () => {
    const core = terminal()
    expect(core.snapshot()).toMatchObject({ cursorStyle: 1, cursorBlinking: true })
    core.setTheme({ ...theme, cursorStyle: 'bar', cursorBlink: false })
    expect(core.snapshot()).toMatchObject({ cursorStyle: 0, cursorBlinking: false })
    core.write('\x1b[3 q')
    expect(core.snapshot()).toMatchObject({ cursorStyle: 2, cursorBlinking: true })
    core.setTheme({ ...theme, cursorStyle: 'block', cursorBlink: false })
    expect(core.snapshot()).toMatchObject({ cursorStyle: 2, cursorBlinking: true })
    core.write('\x1b[0 q')
    expect(core.snapshot()).toMatchObject({ cursorStyle: 1, cursorBlinking: false })
    core.setTheme({ ...theme, cursorStyle: 'underline', cursorBlink: true })
    expect(core.snapshot()).toMatchObject({ cursorStyle: 2, cursorBlinking: true })
    core.write('\x1b[?12l')
    expect(core.snapshot()).toMatchObject({ cursorStyle: 2, cursorBlinking: false })
  })

  it('preserves the primary screen across alternate-screen programs and resizing', () => {
    const core = terminal()
    core.write('primary\x1b[?1049h\x1b[HALT')
    expect(core.isAlternateScreen()).toBe(true)
    expect(rowText(core.snapshot(), 0)).toBe('ALT')
    core.resize(10, 6, 8, 16)
    expect(core.snapshot()).toMatchObject({ cols: 10, rows: 6 })
    core.write('\x1b[?1049l')
    expect(core.isAlternateScreen()).toBe(false)
    expect(rowText(core.snapshot(), 0)).toBe('primary')
  })

  it('keeps prior snapshots stable while scrolling and later output changes the screen', () => {
    const core = terminal()
    core.write('one\r\ntwo\r\nthree\r\nfour\r\nfive')
    const bottom = core.snapshot()
    expect(rowText(bottom, 0)).toBe('two')
    core.scroll(-1)
    expect(rowText(core.snapshot(), 0)).toBe('one')
    core.scrollToBottom()
    core.write('\r\nsix')
    expect(rowText(core.snapshot(), 0)).toBe('three')
    expect(rowText(bottom, 0)).toBe('two')
  })

  it('extracts selection text from the authoritative grid', () => {
    const core = terminal()
    core.write('hello world')
    core.setSelection({ x: 0, y: 0 }, { x: 4, y: 0 })
    expect(core.selectionText()).toBe('hello')
    core.clearSelection()
    expect(core.selectionText()).toBe('')
  })

  it('encodes SGR mouse coordinates only when the program enables tracking', () => {
    const core = terminal()
    const input = {
      action: 'press' as const,
      button: 1,
      mods: 0,
      x: 8,
      y: 16,
      screenWidth: 160,
      screenHeight: 64,
      cellWidth: 8,
      cellHeight: 16,
      paddingLeft: 0,
      paddingRight: 0,
      paddingTop: 0,
      paddingBottom: 0,
      anyButtonPressed: false
    }
    expect(core.encodeMouse(input)).toBe('')
    core.write('\x1b[?1000h\x1b[?1006h')
    expect(core.encodeMouse(input)).toBe('\x1b[<0;2;2M')
    core.resize(100, 4, 8.4, 16.4)
    const fractional = { ...input, x: 8.4 * 78 + 1, y: 16.4 + 1, cellWidth: 8.4, cellHeight: 16.4, screenWidth: 840 }
    expect(core.encodeMouse(fractional)).toBe('\x1b[<0;79;2M')
    core.write('\x1b[?1016h')
    expect(core.encodeMouse(fractional)).toBe(`\x1b[<0;${Math.floor(fractional.x)};${Math.floor(fractional.y)}M`)
  })

  it('refreshes WASM views after memory growth', () => {
    const core = terminal()
    core.write('before')
    core.snapshot()
    runtime.memory.grow(1)
    core.write('\rafter!')
    expect(rowText(core.snapshot(), 0)).toBe('after!')
  })

  it('isolates separate owner runtimes and terminal modes', async () => {
    const otherRuntime = await GhosttyRuntime.create(assets)
    const first = terminal()
    const second = terminal(() => {}, otherRuntime)
    first.write('private\x1b[?1h')
    second.write('other')
    expect(otherRuntime.memory).not.toBe(runtime.memory)
    expect(rowText(second.snapshot(), 0)).toBe('other')
    expect(second.encodeKey(arrowUp)).toBe('\x1b[A')
    expect(first.encodeKey(arrowUp)).toBe('\x1bOA')
  })
})
