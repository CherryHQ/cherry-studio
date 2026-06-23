import type { Tab } from '@shared/data/cache/cacheValueTypes'
import type { SidebarIcon } from '@shared/data/preference/preferenceTypes'
import {
  TAB_INSTANCE_METADATA_APP_ID,
  TAB_INSTANCE_METADATA_KEY,
  type TabInstanceAppId
} from '@shared/types/tabInstanceMetadata'
import { normalizeTabInstanceMetadata } from '@shared/utils/tabInstanceMetadata'

export interface TabInstanceMetadataInput {
  appId?: TabInstanceAppId
  key?: string | null
}

export function buildTabInstanceMetadata(
  currentMetadata: Tab['metadata'],
  instance: TabInstanceMetadataInput
): NonNullable<Tab['metadata']> {
  const metadata = { ...currentMetadata } as NonNullable<Tab['metadata']>

  if (instance.appId) {
    metadata[TAB_INSTANCE_METADATA_APP_ID] = instance.appId
    if (instance.key) {
      metadata[TAB_INSTANCE_METADATA_KEY] = instance.key
    } else {
      delete metadata[TAB_INSTANCE_METADATA_KEY]
    }
    return metadata
  }

  delete metadata[TAB_INSTANCE_METADATA_APP_ID]
  delete metadata[TAB_INSTANCE_METADATA_KEY]
  return metadata
}

export function clearTabInstanceMetadata(currentMetadata: Tab['metadata']): Tab['metadata'] {
  if (!currentMetadata) return undefined
  const metadata = { ...currentMetadata }
  delete metadata[TAB_INSTANCE_METADATA_APP_ID]
  delete metadata[TAB_INSTANCE_METADATA_KEY]
  return Object.keys(metadata).length ? metadata : undefined
}

export function getTabInstanceAppId(tab: Pick<Tab, 'metadata'>): TabInstanceAppId | undefined {
  return normalizeTabInstanceMetadata(tab.metadata)?.[TAB_INSTANCE_METADATA_APP_ID]
}

export function hasTabInstanceMetadataForApp(tab: Pick<Tab, 'metadata'>, appId: SidebarIcon): boolean {
  return getTabInstanceAppId(tab) === appId
}

export function getTabInstanceKey(tab: Pick<Tab, 'metadata'>, appId: SidebarIcon): string | undefined {
  const metadata = normalizeTabInstanceMetadata(tab.metadata)
  if (!metadata) return undefined

  const metadataKey = metadata[TAB_INSTANCE_METADATA_KEY]
  if (metadata[TAB_INSTANCE_METADATA_APP_ID] !== appId || !metadataKey) return undefined

  return metadataKey
}
