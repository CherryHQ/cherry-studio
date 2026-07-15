import { getFilePreviewExtension } from '@renderer/utils/filePreview'
import { normalizeExt } from '@shared/utils/file'

import type { FilePreviewPlugin } from './types'

export interface FilePreviewRegistry {
  extensionPlugins: ReadonlyMap<string, FilePreviewPlugin>
  textFallbackPlugin: FilePreviewPlugin | null
}

interface CreateFilePreviewRegistryOptions {
  extensionPlugins: readonly FilePreviewPlugin[]
  textFallbackPlugin?: FilePreviewPlugin | null
}

export function createFilePreviewRegistry({
  extensionPlugins,
  textFallbackPlugin = null
}: CreateFilePreviewRegistryOptions): FilePreviewRegistry {
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

  return { extensionPlugins: pluginsByExtension, textFallbackPlugin }
}

export function resolveExtensionPlugin(filePath: string, registry: FilePreviewRegistry): FilePreviewPlugin | null {
  const extension = getFilePreviewExtension(filePath)
  return extension ? (registry.extensionPlugins.get(extension) ?? null) : null
}

export const filePreviewRegistry = createFilePreviewRegistry({ extensionPlugins: [] })
