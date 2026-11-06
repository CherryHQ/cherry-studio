import type { ChildProjectionState, MessageProjectionUpdate, MessageProjectionView } from './messageProjection'

export type AgentChildView = MessageProjectionView<ChildProjectionState>
export type AgentChildUpdate = MessageProjectionUpdate<ChildProjectionState>
