import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { application } from '@application'
import type { pdfjsRequestSchemas } from '@shared/ipc/schemas/pdfjs'
import type { IpcHandlersFor } from '@shared/ipc/types'

/** Maximum bytes one pdf.js built-in resource read may return. */
export const PDFJS_RESOURCE_MAX_BYTES = 1024 * 1024

const PDFJS_RESOURCE_DIRS = {
  cmap: 'cmaps',
  standard_font: 'standard_fonts'
} as const

// CMaps are binary (`*.bcmap`); standard font files already carry their extension.
const PDFJS_RESOURCE_EXTENSIONS = {
  cmap: '.bcmap',
  standard_font: ''
} as const

/**
 * Serves pdf.js's bundled CMaps / standard fonts from the packaged application
 * tree. In packaged builds `app.root` is the asar and `readFile` reads inside it
 * through Electron's fs patch, so no unpacking is needed; in development it is
 * the repository root with the same node_modules layout.
 */
export const pdfjsHandlers: IpcHandlersFor<typeof pdfjsRequestSchemas> = {
  'pdfjs.resource.read': async ({ kind, name }) => {
    const baseDir = path.resolve(
      application.getPath('app.root'),
      'node_modules',
      'pdfjs-dist',
      PDFJS_RESOURCE_DIRS[kind]
    )
    const target = path.resolve(baseDir, `${name}${PDFJS_RESOURCE_EXTENSIONS[kind]}`)

    // Belt over the schema's basename pattern: the prefix re-check keeps a
    // traversal out even if a future schema relaxation loosens the name rule.
    if (!target.startsWith(`${baseDir}${path.sep}`)) {
      throw new Error(`Refusing pdf.js resource outside its bundle directory: ${name}`)
    }

    const content = new Uint8Array(await readFile(target))
    if (content.byteLength > PDFJS_RESOURCE_MAX_BYTES) {
      throw new Error(`pdf.js resource exceeds the size cap: ${name} (${content.byteLength} bytes)`)
    }

    return { content }
  }
}
