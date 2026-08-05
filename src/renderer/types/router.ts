import type { ConversationAppId } from './conversation'

export interface TabRouterContext {
  hasOtherConversationTab: (appId: ConversationAppId) => boolean
}
