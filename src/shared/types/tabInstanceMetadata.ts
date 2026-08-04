export const TAB_INSTANCE_METADATA_APP_ID = 'instanceAppId'
export const TAB_INSTANCE_METADATA_KEY = 'instanceKey'

export type TabInstanceAppId = 'assistants' | 'agents'

export type TabInstanceMetadata = {
  [TAB_INSTANCE_METADATA_APP_ID]: TabInstanceAppId
  [TAB_INSTANCE_METADATA_KEY]?: string
}

// The runtime guard `isTabInstanceAppId` and the `normalizeTabInstanceMetadata`
// converter live in `@shared/utils/tabInstanceMetadata`.
