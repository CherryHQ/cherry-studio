import type { AgentCheckpointPage, AgentCursor, AgentEvent, AgentParams } from '@cherrystudio/remote-protocol/agent'

import type { RemoteAgentHub } from './agentJournal'
import { RemoteSubscriptions, type SubscriptionBudget } from './RemoteSubscriptions'

export class AgentSubscriptions extends RemoteSubscriptions<AgentCursor, AgentCheckpointPage, AgentEvent> {
  constructor(hub: RemoteAgentHub, send: (notification: unknown) => Promise<void>, budget?: SubscriptionBudget) {
    super(
      hub,
      send,
      {
        namespace: 'agent',
        resourceKey: 'sessionId',
        resourceOf: (cursor) => cursor.sessionId,
        cursor: (sessionId, streamEpoch, seq) => ({ sessionId, streamEpoch, seq })
      },
      budget
    )
  }
  subscribeSession(input: AgentParams<'agent.sessions.subscribe'>) {
    return super.subscribe({ resourceId: input.sessionId, cursor: input.cursor })
  }
}
