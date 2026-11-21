import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { GhosttyRuntime } from '../../../../src/main/services/terminal/ghostty/GhosttyRuntime'
import { GhosttyTerminalCore } from '../../../../src/main/services/terminal/ghostty/GhosttyTerminalCore'

export async function checkGhostty(assetDirectory: string, onLog: (message: string) => void) {
  const [wasm, trampoline, manifest] = await Promise.all([
    readFile(path.join(assetDirectory, 'ghostty-vt.wasm')),
    readFile(path.join(assetDirectory, 'ghostty-write-pty.wasm')),
    readFile(path.join(assetDirectory, 'manifest.json'), 'utf8')
  ])
  const { ghosttyRevision: revision } = JSON.parse(manifest) as { ghosttyRevision: string }
  const runtime = await GhosttyRuntime.create({
    wasm: Uint8Array.from(wasm),
    writePtyWasm: Uint8Array.from(trampoline),
    revision,
    onLog
  })
  const replies: string[] = []
  const siblingReplies: string[] = []
  const options = {
    runtime,
    cols: 20,
    rows: 4,
    cellWidth: 8,
    cellHeight: 16,
    scrollbackBytes: 8 * 1024 * 1024,
    theme: {
      foreground: { r: 255, g: 255, b: 255 },
      background: { r: 0, g: 0, b: 0 },
      cursor: { r: 255, g: 255, b: 255 }
    }
  }
  const core = GhosttyTerminalCore.create({ ...options, onPtyData: (data) => replies.push(data) })
  const sibling = GhosttyTerminalCore.create({ ...options, onPtyData: (data) => siblingReplies.push(data) })
  try {
    core.write('世界\x1b[6n')
    const unicode = core.snapshot().rowData[0].text
    core.openSearch('smoke', '世界')
    const searchCount = core.advanceSearch('smoke', true).count
    const searchIndex = core.navigateSearch('smoke', 'next').selected?.index ?? null
    core.closeSearch('smoke')
    const key = { key: 78, mods: 0, consumedMods: 0, composing: false, unshiftedCodepoint: 0, text: '', repeat: false }
    const normalKey = core.encodeKey(key)
    core.write('\x1b[?1h\x1b[?2004h')
    const applicationKey = core.encodeKey(key)
    const paste = core.encodePaste('中文')
    core.write('\x1b[?1049h\x1b[HALT')
    const alternate = core.snapshot().rowData[0].text
    core.write('\x1b[?1049l')
    const restored = core.snapshot().rowData[0].text
    core.resize(10, 6, 8, 16)
    const { cols, rows } = core.snapshot()
    core.dispose()
    sibling.write('alive\x1b[5n')
    return {
      node: process.version,
      revision,
      unicode,
      searchCount,
      searchIndex,
      reply: replies.join(''),
      normalKey,
      applicationKey,
      paste,
      alternate,
      restored,
      cols,
      rows,
      siblingText: sibling.snapshot().rowData[0].text,
      siblingReply: siblingReplies.join('')
    }
  } finally {
    core.dispose()
    sibling.dispose()
  }
}
