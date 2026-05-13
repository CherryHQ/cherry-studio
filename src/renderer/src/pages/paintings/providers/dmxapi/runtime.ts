import type { FileMetadata } from '@renderer/types'
import type { PaintingMode } from '@shared/data/types/painting'

import type { DMXApiModelData, DMXApiModelGroups } from './config'

export interface DmxapiFileMap {
  imageFiles: FileMetadata[]
  paths: string[]
}

let fileMap: DmxapiFileMap = { imageFiles: [], paths: [] }
const fileMapListeners = new Set<() => void>()

let cachedModelGroups: DMXApiModelGroups | null = null
let cachedAllModels: DMXApiModelData[] = []

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

export function getDmxapiModelGroups() {
  return cachedModelGroups
}

export function setDmxapiModelGroups(groups: DMXApiModelGroups) {
  cachedModelGroups = groups
  cachedAllModels = Object.values(groups).flatMap((group) => Object.values(group).flat())
}

export function getDmxapiAllModels() {
  return cachedAllModels
}

export function getDmxapiModelOptionsForMode(mode: string, modelGroups: DMXApiModelGroups | null) {
  if (!modelGroups) return {}
  if (mode === 'edit') return modelGroups.IMAGE_EDIT || {}
  if (mode === 'merge') return modelGroups.IMAGE_MERGE || {}
  return modelGroups.TEXT_TO_IMAGES || {}
}

export function getFirstDmxapiModelInfo(mode: string, modelGroups: DMXApiModelGroups | null) {
  const groups = getDmxapiModelOptionsForMode(mode, modelGroups)
  let model = ''
  let priceModel = ''
  let image_size = ''
  let extend_params = {}

  for (const provider of Object.keys(groups)) {
    if (groups[provider] && groups[provider].length > 0) {
      model = groups[provider][0].id
      priceModel = groups[provider][0].price
      image_size = groups[provider][0].image_sizes[0].value
      extend_params = (groups[provider][0] as any).extend_params || {}
      break
    }
  }

  return { model, priceModel, image_size, extend_params }
}

export function toDmxapiDbMode(mode?: string): PaintingMode {
  if (mode === 'edit') return 'edit'
  if (mode === 'merge') return 'merge'
  return 'generate'
}
