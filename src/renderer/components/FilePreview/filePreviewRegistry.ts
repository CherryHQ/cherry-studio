import { getFilePreviewExtension } from '@renderer/utils/filePreview'
import { normalizeExt } from '@shared/utils/file'

import { htmlFilePreviewPlugin } from './plugins/html/htmlFilePreviewPlugin'
import { imageFilePreviewPlugin } from './plugins/image/imageFilePreviewPlugin'
import { markdownFilePreviewPlugin } from './plugins/markdown/markdownFilePreviewPlugin'
import { pdfFilePreviewPlugin } from './plugins/pdf/pdfFilePreviewPlugin'
import { powerPointFilePreviewPlugin } from './plugins/powerpoint/powerPointFilePreviewPlugin'
import { textFilePreviewPlugin } from './plugins/text/textFilePreviewPlugin'
import { wordFilePreviewPlugin } from './plugins/word/wordFilePreviewPlugin'
import type { FilePreviewPlugin } from './types'

export interface FilePreviewRegistry {
  extensionPlugins: ReadonlyMap<string, FilePreviewPlugin>
}

interface CreateFilePreviewRegistryOptions {
  extensionPlugins: readonly FilePreviewPlugin[]
}

export function createFilePreviewRegistry({ extensionPlugins }: CreateFilePreviewRegistryOptions): FilePreviewRegistry {
  const pluginsByExtension = new Map<string, FilePreviewPlugin>()

  for (const plugin of extensionPlugins) {
    for (const extension of plugin.extensions) {
      if (normalizeExt(extension) !== extension) {
        throw new Error(`Invalid file preview extension: ${extension}`)
      }
      if (pluginsByExtension.has(extension)) {
        throw new Error(`Duplicate file preview extension: ${extension}`)
      }
      pluginsByExtension.set(extension, plugin)
    }
  }

  return { extensionPlugins: pluginsByExtension }
}

export function resolveExtensionPlugin(filePath: string, registry: FilePreviewRegistry): FilePreviewPlugin | null {
  const extension = getFilePreviewExtension(filePath)
  return extension ? (registry.extensionPlugins.get(extension) ?? null) : null
}

export const filePreviewRegistry = createFilePreviewRegistry({
  extensionPlugins: [
    htmlFilePreviewPlugin,
    imageFilePreviewPlugin,
    markdownFilePreviewPlugin,
    pdfFilePreviewPlugin,
    powerPointFilePreviewPlugin,
    textFilePreviewPlugin,
    wordFilePreviewPlugin
  ]
})
