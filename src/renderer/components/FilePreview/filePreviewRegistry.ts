import { previewFormats } from '@cherrystudio/file-preview/react'
import { getFilePreviewExtension } from '@renderer/utils/filePreview'
import { normalizeExt } from '@shared/utils/file'

import { htmlFilePreviewPlugin } from './plugins/html/htmlFilePreviewPlugin'
import { markdownFilePreviewPlugin } from './plugins/markdown/markdownFilePreviewPlugin'
import { textFilePreviewPlugin } from './plugins/text/textFilePreviewPlugin'
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
    ...previewFormats.map((format) => ({ ...format, load: () => import('./ElectronFilePreview') })),
    htmlFilePreviewPlugin,
    markdownFilePreviewPlugin,
    textFilePreviewPlugin
  ]
})

/** Whether the plugin that would render `filePath` declares `supportsSelectionReference`. */
export function canProduceSelectionReference(filePath: string): boolean {
  return resolveExtensionPlugin(filePath, filePreviewRegistry)?.supportsSelectionReference === true
}
