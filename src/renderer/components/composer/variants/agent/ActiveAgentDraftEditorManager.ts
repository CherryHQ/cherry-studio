import type { AgentComposerDraftCache } from './agentDraftCache'

export type SubmittedAgentDraft = Pick<AgentComposerDraftCache, 'text' | 'tokens' | 'files' | 'knowledgeBaseIds'>

export type ActiveAgentDraftEditor = {
  /** The owning instance's clear callback — identifies same-instance settlements. */
  owner: (options?: { preserveCache?: boolean }) => void
  /** True only while the visible editor holds exactly this submitted document. */
  isShowing: (submitted: SubmittedAgentDraft) => boolean
  /** Clear the submitted document from the editor, keeping an unrelated cached draft untouched. */
  clearSubmitted: (options: { preserveCache: boolean; submitted?: boolean }) => void
}

// The visible editor for each draft-cache key survives callback settlement
// in an unmounted instance. A stale cleanup may not remove its replacement.
class ActiveAgentDraftEditorManager {
  private readonly editors = new Map<string, ActiveAgentDraftEditor>()

  register(key: string, editor: ActiveAgentDraftEditor): void {
    this.editors.set(key, editor)
  }

  get(key: string): ActiveAgentDraftEditor | undefined {
    return this.editors.get(key)
  }

  unregister(key: string, editor: ActiveAgentDraftEditor): void {
    if (this.editors.get(key) === editor) this.editors.delete(key)
  }
}

export const activeAgentDraftEditorManager = new ActiveAgentDraftEditorManager()
