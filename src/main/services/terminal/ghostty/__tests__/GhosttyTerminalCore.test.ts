import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { afterEach, beforeAll, describe, expect, it } from 'vitest'

import manifest from '../../../../../../resources/terminal/ghostty/manifest.json'
import { TerminalBlockIndex } from '../../utilityEntries/TerminalBlockIndex'
import { TerminalSearch } from '../../utilityEntries/TerminalSearch'
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
  it('finishes native history search through bounded Host turns without relying on a view to feed it', () => {
    const core = terminal()
    core.write(Array.from({ length: 5000 }, (_, n) => `row ${n} find\r\n`).join(''))
    const index = new TerminalBlockIndex(core, 'scheduled')
    const query = new TerminalSearch('scheduled-query', 1, { kind: 'terminal' }, 'find', core, index)
    let result = query.step(core.revision)
    for (let n = 0; n < 200 && result.status === 'searching'; n++) result = query.step(core.revision)
    expect(result).toMatchObject({ status: 'caught-up', count: 5000 })
    query.close()
    index.dispose()
  })
  it('does not expose a disclosure for ANSI-only output that moves the cursor through blank rows', () => {
    const core = terminal()
    const index = new TerminalBlockIndex(core, 'empty')
    index.boundary({ kind: 'prompt', revision: 1, exitCode: 0, cwd: '/tmp' })
    core.write('❯ true\r\n')
    index.boundary({ kind: 'program', revision: 2, command: 'true' })
    core.write('\x1b[2B')
    index.written()
    index.boundary({ kind: 'prompt', revision: 3, exitCode: 0, cwd: '/tmp' })
    expect(index.summaries()[0]).toMatchObject({ outputEmpty: true, status: 'completed' })
    index.dispose()
  })
  it('refreshes block search geometry after reflow and refuses navigation using its old result revision', () => {
    const core = terminal()
    core.resize(80, 10, 8, 16)
    const index = new TerminalBlockIndex(core, 'reflow')
    index.boundary({ kind: 'prompt', revision: 1, exitCode: 0, cwd: '/tmp' })
    core.write('❯ run\r\n')
    index.boundary({ kind: 'program', revision: 2, command: 'run' })
    core.write('prefix 中文🙂1234567890 tail\r\n')
    index.written()
    index.boundary({ kind: 'prompt', revision: 3, exitCode: 0, cwd: '/tmp' })
    const block = index.summaries()[0]
    const query = new TerminalSearch('reflow-query', 1, { kind: 'block', blockId: block.id }, '中文🙂', core, index)
    const before = structuredClone(query.step(core.revision))
    expect(before.count).toBe(1)
    expect(before.matches).toHaveLength(1)
    core.resize(10, 10, 8, 16)
    expect(query.navigate(before.resultRevision, 'next', core.revision)).toBeNull()
    const after = query.step(core.revision)
    expect(after.count).toBe(1)
    expect(after.matches[0].end.y).toBeGreaterThan(before.matches[0].end.y)
    expect(query.navigate(after.resultRevision, 'next', core.revision)?.selected?.range).toEqual(after.matches[0])
    query.close()
    index.dispose()
  })
  it('returns an explicit bounded suffix for large blocks and preserves complete command metadata', () => {
    const core = terminal()
    const index = new TerminalBlockIndex(core, 'large')
    index.boundary({ kind: 'prompt', revision: 1, exitCode: 0, cwd: '/tmp' })
    core.write('❯ large\r\n')
    index.boundary({ kind: 'program', revision: 2, command: 'large' })
    for (let n = 0; n < 2000; n++) core.write(`row-${n}: ${'中文🙂'.repeat(12)}\r\n`)
    index.written()
    index.boundary({ kind: 'prompt', revision: 3, exitCode: 0, cwd: '/tmp' })
    const block = index.summaries()[0]
    const read = index.read(block.id, 'block')
    expect(read.kind).toBe('content')
    if (read.kind !== 'content') throw new Error('No captured output')
    expect(read.partial).toContain('size')
    expect(read.text).toContain('"partial":["size"]')
    expect(read.text).toContain('\nlarge\n')
    expect(read.text).toContain('row-1999:')
    expect(read.text).not.toContain('row-0:')
    expect(Buffer.byteLength(JSON.stringify(read))).toBeLessThanOrEqual(60 * 1024)
    expect(read.text).not.toContain('\ufffd')
    index.dispose()
  })

  it('retires old metadata at its byte budget without losing the active or newest command', () => {
    const core = terminal()
    const index = new TerminalBlockIndex(core, 'metadata')
    index.boundary({ kind: 'prompt', revision: 1, exitCode: 0, cwd: '/tmp' })
    let first = ''
    for (let n = 0; n < 270; n++) {
      core.write('❯ run\r\n')
      index.boundary({ kind: 'program', revision: n * 2 + 2, command: `${n}:` + 'x'.repeat(8000) })
      if (n === 0) first = index.summaries()[0].id
      core.write('done\r\n')
      index.written()
      index.boundary({ kind: 'prompt', revision: n * 2 + 3, exitCode: 0, cwd: '/tmp' })
    }
    const blocks = index.summaries()
    expect(blocks.length).toBeLessThan(256)
    expect(Buffer.byteLength(JSON.stringify(blocks))).toBeLessThanOrEqual(256 * 1024)
    expect(blocks.at(-1)?.command).toMatch(/^269:/)
    expect(index.read(first, 'block')).toEqual({ kind: 'unavailable' })
    index.dispose()
  })

  it('releases block query capacity on close so a failed allocation cannot damage execution', () => {
    const core = terminal()
    const index = new TerminalBlockIndex(core, 'queries')
    const queries = Array.from(
      { length: 33 },
      (_, n) => new TerminalSearch(`block-${n}`, 1, { kind: 'block', blockId: 'missing' }, 'find', core, index)
    )
    expect(queries.at(-1)?.projection.status).toBe('capacity')
    for (const query of queries) query.close()
    const next = new TerminalSearch('reused', 2, { kind: 'block', blockId: 'missing' }, 'find', core, index)
    expect(next.projection.status).toBe('searching')
    next.close()
    core.write('usable')
    expect(rowText(core.snapshot(), 0)).toBe('usable')
    index.dispose()
  })
  it('keeps immutable command/output ranges across scrolling and reflow, and invalidates overwritten regions', () => {
    const core = terminal()
    core.resize(80, 10, 8, 16)
    const index = new TerminalBlockIndex(core, 'resource')
    index.boundary({ kind: 'prompt', revision: 1, exitCode: 0, cwd: '/tmp' })
    core.write('❯ printf test\r\n')
    index.boundary({ kind: 'program', revision: 2, command: 'printf test' })
    core.write('中文🙂\r\nsecond\r\n')
    index.written()
    index.boundary({ kind: 'prompt', revision: 3, exitCode: 0, cwd: '/tmp' })
    core.write('❯ ')
    const [block] = index.summaries()
    expect(block).toMatchObject({ command: 'printf test', status: 'completed', reliable: true })
    expect(index.read(block.id, 'output')).toMatchObject({ kind: 'content', text: '中文🙂\nsecond' })
    core.resize(10, 10, 8, 16)
    expect(index.read(block.id, 'output')).toMatchObject({ kind: 'content', text: '中文🙂\nsecond' })
    core.write('\x1b[3;1HREPLACED')
    expect(index.summaries()[0].reliable).toBe(false)
    expect(index.read(block.id, 'output')).toEqual({ kind: 'unavailable' })
    expect(index.read(block.id, 'command')).toMatchObject({ kind: 'content', text: 'printf test' })
    index.dispose()
  })

  it('refuses an exact expired block revision and keeps normal selections while formatting offscreen output', () => {
    const core = terminal()
    const index = new TerminalBlockIndex(core, 'resource')
    index.boundary({ kind: 'prompt', revision: 1, exitCode: 0, cwd: '/tmp' })
    core.write('❯ run\r\n')
    index.boundary({ kind: 'program', revision: 2, command: 'run' })
    for (let i = 0; i < 30; i++) core.write(`line ${i}\r\n`)
    index.written()
    index.boundary({ kind: 'prompt', revision: 3, exitCode: 0, cwd: '/tmp' })
    core.write('❯ ')
    const block = index.summaries()[0]
    core.setSelection({ x: 0, y: 0 }, { x: 3, y: 0 })
    const selected = core.selectionText()
    expect(index.read(block.id, 'output')).toMatchObject({ kind: 'content' })
    expect(core.selectionText()).toBe(selected)
    expect(index.read(block.id, 'output', block.contentRevision - 1)).toEqual({ kind: 'stale' })
    index.dispose()
  })

  it('encodes printable UTF-8 keys and an IME commit using the current string ABI', () => {
    const core = terminal()
    const event = {
      key: 20,
      mods: 0,
      consumedMods: 0,
      composing: false,
      unshiftedCodepoint: 97,
      text: 'a',
      repeat: false
    }
    expect(core.encodeKey(event)).toBe('a')
    expect(core.encodeKey({ ...event, key: 0, text: '中文🙂', unshiftedCodepoint: 0 })).toBe('中文🙂')
    expect(core.encodeKey({ ...event, key: 0, text: 'echo hello', unshiftedCodepoint: 0 })).toBe('echo hello')
    expect(core.encodeKey(arrowUp)).toBe('\x1b[A')
    expect(core.encodePaste('中文🙂')).toBe('中文🙂')
  })

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
