import { describe, expect, it } from 'vitest'

import { ANALYTICS_INVENTORY_FILE, uiContractPlugin } from '../vitePlugin'

type Hook = (this: unknown, ...args: unknown[]) => unknown

function buildInventory(files: Record<string, string>): unknown {
  const root = '/repo'
  const plugin = uiContractPlugin({ root })
  for (const [file, source] of Object.entries(files)) (plugin.transform as Hook).call({}, source, `${root}/${file}`)
  const emitted: Array<{ fileName: string; source: string }> = []
  ;(plugin.generateBundle as Hook).call({ emitFile: (asset: (typeof emitted)[number]) => emitted.push(asset) })
  expect(emitted.map((asset) => asset.fileName)).toEqual([ANALYTICS_INVENTORY_FILE])
  return JSON.parse(emitted[0].source)
}

describe('analytics control inventory', () => {
  it('groups every injected control name by page, with shared components under other', () => {
    const button = (handler: string) => `const Panel = () => <button onClick={${handler}}>x</button>`

    const inventory = buildInventory({
      'src/renderer/pages/notes/NotesToolbar.tsx': button('handleExport'),
      'src/renderer/pages/miniApps/MiniAppsPage.tsx': button('handlePin'),
      'src/renderer/windows/selection/toolbar/SelectionToolbar.tsx': button('handleCopy'),
      'src/renderer/components/Shared.tsx': button('handleOpen')
    })

    expect(inventory).toEqual({
      pages: {
        mini_app: [expect.stringMatching(/:pin$/)],
        notes: [expect.stringMatching(/:export$/)],
        other: ['ui.panel:open'],
        selection: [expect.stringMatching(/:copy$/)]
      }
    })
  })

  it('keeps only the latest transform of a file, so a rebuilt file never leaves stale names', () => {
    const file = 'src/renderer/pages/notes/NotesToolbar.tsx'
    const root = '/repo'
    const plugin = uiContractPlugin({ root })
    const transform = plugin.transform as Hook
    transform.call({}, `const Panel = () => <button onClick={handleOld}>x</button>`, `${root}/${file}`)
    transform.call({}, `const Panel = () => <button onClick={handleNew}>x</button>`, `${root}/${file}`)
    const emitted: Array<{ source: string }> = []
    ;(plugin.generateBundle as Hook).call({ emitFile: (asset: { source: string }) => emitted.push(asset) })

    const names = (JSON.parse(emitted[0].source) as { pages: Record<string, string[]> }).pages.notes
    expect(names).toHaveLength(1)
    expect(names[0]).toMatch(/:new$/)
  })
})
