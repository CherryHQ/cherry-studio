import type { FileMetadata } from '@renderer/types'
import type { PaintingMode } from '@shared/data/types/painting'

export interface DmxapiFileMap {
  imageFiles: FileMetadata[]
  paths: string[]
}

export interface DmxapiModelMeta {
  id: string
  image_sizes: Array<{ label: string; value: string }>
  is_custom_size: boolean
  min_image_size?: number
  max_image_size?: number
}

let fileMap: DmxapiFileMap = { imageFiles: [], paths: [] }
const fileMapListeners = new Set<() => void>()

/**
 * Sync lookup cache for dmxapi's per-model UI metadata, populated by the
 * model loader after registry data arrives. The painting page's field
 * renderer reads from this at render time via `getDmxapiModelMeta(modelId)`
 * because the field-options callback signature is synchronous.
 */
const modelMetaCache = new Map<string, DmxapiModelMeta>()

export function setDmxapiModelMetaCache(entries: DmxapiModelMeta[]) {
  modelMetaCache.clear()
  for (const entry of entries) modelMetaCache.set(entry.id, entry)
}

export function getDmxapiModelMeta(modelId: string | undefined): DmxapiModelMeta | undefined {
  if (!modelId) return undefined
  return modelMetaCache.get(modelId)
}

export function getDmxapiFileMap() {
  return fileMap
}

export function subscribeDmxapiFileMap(listener: () => void) {
  fileMapListeners.add(listener)
  return () => {
    fileMapListeners.delete(listener)
  }
}

export function setDmxapiFileMap(updater: (prev: DmxapiFileMap) => DmxapiFileMap) {
  fileMap = updater(fileMap)
  fileMapListeners.forEach((listener) => listener())
}

export function clearDmxapiFileMap() {
  fileMap = { imageFiles: [], paths: [] }
  fileMapListeners.forEach((listener) => listener())
}

export function toDmxapiDbMode(mode?: string): PaintingMode {
  if (mode === 'edit') return 'edit'
  if (mode === 'merge') return 'merge'
  return 'generate'
}
