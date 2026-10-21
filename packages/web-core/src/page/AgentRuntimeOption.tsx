// Wraps the desktop runtime cards: the Web edition runs only Pi agents, so creating one shows Pi instead of a choice.
import type { TFunction } from 'i18next'

import { AgentRuntimeSummary } from '@renderer/components/AgentRuntimeOption'

export { AgentRuntimeSummary }

export function AgentRuntimeTiles({ t }: { t: TFunction }) {
  return <AgentRuntimeSummary value="pi" t={t} />
}
