import { imageFilePreviewPlugin } from './plugins/image/imageFilePreviewPlugin'
import { pdfFilePreviewPlugin } from './plugins/pdf/pdfFilePreviewPlugin'
import { powerPointFilePreviewPlugin } from './plugins/powerpoint/powerPointFilePreviewPlugin'
import { spreadsheetFilePreviewPlugin } from './plugins/spreadsheet/spreadsheetFilePreviewPlugin'
import { wordFilePreviewPlugin } from './plugins/word/wordFilePreviewPlugin'
import type { FilePreviewPlugin } from './types'

const plugins: readonly FilePreviewPlugin[] = [
  imageFilePreviewPlugin,
  pdfFilePreviewPlugin,
  powerPointFilePreviewPlugin,
  spreadsheetFilePreviewPlugin,
  wordFilePreviewPlugin
]

export const previewFormats = plugins.map(({ id, extensions, supportsSelectionReference }) => ({
  id,
  extensions,
  supportsSelectionReference: supportsSelectionReference === true
}))

export function resolvePreviewPlugin(name: string) {
  const extension = name
    .split(/[\\/]/)
    .at(-1)
    ?.match(/\.([^.]+)$/)?.[1]
    .toLowerCase()
  return plugins.find((plugin) => plugin.extensions.includes(extension ?? '')) ?? null
}

export function supportsPreview(name: string): boolean {
  return resolvePreviewPlugin(name) !== null
}

export function canSelectPreview(name: string): boolean {
  return resolvePreviewPlugin(name)?.supportsSelectionReference === true
}
