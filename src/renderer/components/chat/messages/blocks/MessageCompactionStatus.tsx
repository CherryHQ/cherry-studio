import type { ReactNode } from 'react'

import { useSharedCacheValue } from '@renderer/data/hooks/useCache'

import CompactionAnchorBlock from './CompactionAnchorBlock'

export default function MessageCompactionStatus({ messageId, fallback }: { messageId: string; fallback: ReactNode }) {
  const compacting = useSharedCacheValue(`message.context.compacting.${messageId}`)
  return compacting ? <CompactionAnchorBlock data={{ status: 'compacting', phase: 'turn-start' }} /> : fallback
}
