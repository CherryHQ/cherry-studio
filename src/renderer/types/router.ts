import type { TabInstanceAppId } from '@shared/types/tabInstanceMetadata'

export interface TabRouterContext {
  hasOtherConversationTab: (appId: TabInstanceAppId) => boolean
}
