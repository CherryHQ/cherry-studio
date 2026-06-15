export const TAB_INSTANCE_METADATA_APP_ID = 'instanceAppId'
export const TAB_INSTANCE_METADATA_KEY = 'instanceKey'

export type TabInstanceAppId = 'assistants' | 'agents'

export type TabInstanceMetadata = {
  [TAB_INSTANCE_METADATA_APP_ID]: TabInstanceAppId
  [TAB_INSTANCE_METADATA_KEY]?: string
}

export function isTabInstanceAppId(value: unknown): value is TabInstanceAppId {
  return value === 'assistants' || value === 'agents'
}

export function normalizeTabInstanceMetadata(value: unknown): TabInstanceMetadata | undefined {
  if (!value || typeof value !== 'object') return undefined
  const metadata = value as Record<string, unknown>
  const appId = metadata[TAB_INSTANCE_METADATA_APP_ID]
  if (!isTabInstanceAppId(appId)) return undefined

  const key = metadata[TAB_INSTANCE_METADATA_KEY]
  if (key !== undefined && (typeof key !== 'string' || !key)) return undefined

  return {
    [TAB_INSTANCE_METADATA_APP_ID]: appId,
    ...(key ? { [TAB_INSTANCE_METADATA_KEY]: key } : {})
  }
}
