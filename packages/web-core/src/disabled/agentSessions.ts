// Stand-ins for the agent-session dispatch path; agent sessions get their own Web Spec.
import { isAgentSessionTopic } from '@main/ai/agentSession/topic'

import { unsupported } from './unsupported'

export const agentChatContextProvider = {
  name: 'agent-session',
  isPersistentConversation: true,
  canHandle: (topicId: string) => isAgentSessionTopic(topicId),
  prepareDispatch: unsupported('Agent sessions'),
  prepareAgentSessionDispatch: unsupported('Agent sessions')
}

// No agent workspace is ever prepared in the Worker, so no error can be a workspace error.
export const isAgentSessionWorkspaceError = (): boolean => false
export const prepareAgentSessionWorkspaceDirectory = unsupported('Agent session workspaces')
