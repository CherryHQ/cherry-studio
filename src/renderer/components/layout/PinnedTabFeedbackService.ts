import { isEqual } from 'es-toolkit/compat'

export type PinnedTabFeedbackEpisode = { revisions: number; closed: boolean; acceptedValue?: unknown }

const PINNED_FEEDBACK_BUDGET = 8

// TabsProvider alone owns this slot for ui.tab.pinned_tabs; effect turns and remounts
// retain its budget. Other cache keys never participate in this episode.
class PinnedTabFeedbackService {
  private current: PinnedTabFeedbackEpisode = { revisions: 0, closed: false }

  get episode(): PinnedTabFeedbackEpisode {
    return this.current
  }

  begin(): void {
    this.current = { revisions: 0, closed: false }
  }

  observe(episode: PinnedTabFeedbackEpisode, value: unknown, preparedValue: unknown): 'accepted' | 'tripped' {
    const changed =
      !isEqual(value, preparedValue) || (episode.acceptedValue !== undefined && !isEqual(value, episode.acceptedValue))
    if (changed) {
      if (episode.revisions === PINNED_FEEDBACK_BUDGET) {
        episode.closed = true
        return 'tripped'
      }
      episode.revisions += 1
    }
    // An echo of our own preparation is free; a different observed value belongs
    // to the same episode even when it arrives on a later asynchronous turn.
    episode.acceptedValue = preparedValue
    return 'accepted'
  }
}

export const pinnedTabFeedbackService = new PinnedTabFeedbackService()
