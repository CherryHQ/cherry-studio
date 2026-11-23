import { isEqual } from 'es-toolkit/compat'

import type { Tab } from '@shared/data/cache/cacheValueTypes'

export type PinnedTabFeedbackEpisode = { revisions: number; closed: boolean }

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

  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Observed pinned-tab cache values may be malformed; compare the raw observation with the provider's validated repair result.
  observe(episode: PinnedTabFeedbackEpisode, value: unknown, preparedValue: readonly Tab[]): 'accepted' | 'tripped' {
    // Only reconciliation the provider still owes is feedback; a value already equal
    // to the prepared one was written by someone else and is not bounded here.
    const changed = !isEqual(value, preparedValue)

    if (changed) {
      if (episode.revisions === PINNED_FEEDBACK_BUDGET) {
        episode.closed = true

        return 'tripped'
      }

      episode.revisions += 1
    }

    return 'accepted'
  }
}

export const pinnedTabFeedbackService = new PinnedTabFeedbackService()
