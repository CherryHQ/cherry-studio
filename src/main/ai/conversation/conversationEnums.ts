/** Stable terminal outcome selected before persistence. */
export enum ConversationOutcomeKind {
  Success = 'success',
  Error = 'error',
  Paused = 'paused'
}

/** History continuations translated into Main Conversation commands. */
export enum ConversationContinuationTrigger {
  ContinueInteraction = 'continue-conversation',
  ContinueSteer = 'steer-continuation'
}
