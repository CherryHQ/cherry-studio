import { resolve } from 'node:path'

import { normalizePath, type Plugin } from 'vite'

import { isUiSourceFile, windowNameFromHtml } from './scan'
import { normalizeSourceFile } from './semanticId'
import { transformHtml, transformJsx, UI_CONTRACT_RUNTIME_MODULE_ID } from './transform'

export interface UiContractPluginOptions {
  root?: string
}

const RESOLVED_RUNTIME_MODULE_ID = `\0${UI_CONTRACT_RUNTIME_MODULE_ID}`

/** Build artifact listing every named control, so analytics can find controls nobody clicked. */
export const ANALYTICS_INVENTORY_FILE = 'analytics-inventory.json'

// Source directories mapped to the analytics page enum; anything shared counts as `other`.
const SOURCE_PAGES: Record<string, string> = {
  agents: 'agents',
  browser: 'browser',
  code: 'code',
  filePreview: 'files',
  files: 'files',
  home: 'chat',
  knowledge: 'knowledge',
  launchpad: 'launchpad',
  marketplace: 'marketplace',
  miniApps: 'mini_app',
  notes: 'notes',
  paintings: 'paintings',
  releaseNotes: 'release_notes',
  settings: 'settings',
  translate: 'translate',
  quickAssistant: 'quick_assistant',
  selection: 'selection'
}

function analyticsPageOfSource(sourceFile: string): string {
  const match = /^src\/renderer\/(?:pages|windows)\/([^/]+)\//.exec(sourceFile)
  return (match && SOURCE_PAGES[match[1]]) ?? 'other'
}

function buildAnalyticsInventory(namesBySource: ReadonlyMap<string, readonly string[]>): {
  pages: Record<string, string[]>
} {
  const pages: Record<string, Set<string>> = {}
  for (const [sourceFile, names] of namesBySource) {
    const page = analyticsPageOfSource(sourceFile)
    for (const name of names) (pages[page] ??= new Set()).add(name)
  }
  return {
    pages: Object.fromEntries(
      Object.keys(pages)
        .sort()
        .map((page) => [page, [...pages[page]].sort()])
    )
  }
}

export function uiContractPlugin(options: UiContractPluginOptions = {}): Plugin {
  const root = resolve(options.root ?? process.cwd())
  const analyticsNamesBySource = new Map<string, string[]>()

  return {
    name: 'cherry-ui-contract',
    enforce: 'pre',
    resolveId(id) {
      return id === UI_CONTRACT_RUNTIME_MODULE_ID ? RESOLVED_RUNTIME_MODULE_ID : null
    },
    load(id) {
      if (id !== RESOLVED_RUNTIME_MODULE_ID) return null
      // normalizePath keeps the import specifiers forward-slashed on Windows,
      // where raw resolve() output would fail Vite module resolution.
      const runtimePath = normalizePath(resolve(root, 'scripts/uiContract/runtime.ts'))
      const slotPath = normalizePath(resolve(root, 'scripts/uiContract/uiDataSlot.ts'))
      return `
export { mergeDataUi, mergeUiProps } from ${JSON.stringify(runtimePath)}
export { UiDataSlot } from ${JSON.stringify(slotPath)}
`
    },
    transform(source, id) {
      const file = id.split('?')[0]
      if (!isUiSourceFile(file) || !/\.(?:jsx|tsx)$/.test(file)) return null
      const sourceFile = normalizeSourceFile(root, file)
      if (sourceFile.startsWith('../')) return null

      const result = transformJsx(source, {
        injectDataUi: true,
        sourceFile
      })
      analyticsNamesBySource.set(sourceFile, result.analyticsNames)
      return { code: result.code, map: result.map }
    },
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: ANALYTICS_INVENTORY_FILE,
        source: `${JSON.stringify(buildAnalyticsInventory(analyticsNamesBySource), null, 2)}\n`
      })
    },
    transformIndexHtml: {
      order: 'pre',
      handler(html, context) {
        if (!context.filename) return html
        const sourceFile = normalizeSourceFile(root, context.filename)
        const result = transformHtml(html, {
          injectDataUi: true,
          sourceFile,
          windowName: windowNameFromHtml(sourceFile)
        })
        return result.code
      }
    }
  }
}
