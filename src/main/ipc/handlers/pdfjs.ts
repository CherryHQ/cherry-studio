import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { application } from '@application'
import type { pdfjsRequestSchemas } from '@shared/ipc/schemas/pdfjs'
import type { IpcHandlersFor } from '@shared/ipc/types'

/** Maximum bytes one pdf.js built-in resource read may return. */
export const PDFJS_RESOURCE_MAX_BYTES = 1024 * 1024

const PDFJS_RESOURCE_PATHS = {
  cmap: 'feature.pdfjs.cmaps',
  standard_font: 'feature.pdfjs.standard_fonts'
} as const

// CMaps are binary (`*.bcmap`); standard font files already carry their extension.
const PDFJS_RESOURCE_EXTENSIONS = {
  cmap: '.bcmap',
  standard_font: ''
} as const

/**
 * Serves pdf.js's CMaps / standard fonts. Packaged builds ship them as
 * `extraResources` under `Resources/pdfjs/`; in development they are read from
 * `node_modules/pdfjs-dist`.
 */
export const pdfjsHandlers: IpcHandlersFor<typeof pdfjsRequestSchemas> = {
  'pdfjs.resource.read': async ({ kind, name }) => {
    const pathKey = PDFJS_RESOURCE_PATHS[kind]
    const baseDir = application.getPath(pathKey)
    const filename = `${name}${PDFJS_RESOURCE_EXTENSIONS[kind]}`
    const target = application.getPath(pathKey, filename)

    // Belt over the schema's basename pattern: the prefix re-check keeps a
    // traversal out even if a future schema relaxation loosens the name rule.
    if (path.isAbsolute(filename) || !target.startsWith(`${baseDir}${path.sep}`)) {
      throw new Error(`Refusing pdf.js resource outside its bundle directory: ${name}`)
    }

    const content = new Uint8Array(await readFile(target))
    if (content.byteLength > PDFJS_RESOURCE_MAX_BYTES) {
      throw new Error(`pdf.js resource exceeds the size cap: ${name} (${content.byteLength} bytes)`)
    }

    return { content }
  }
}
