import type { AgentTaskEventPartData } from '@shared/data/types/uiParts'

export function childTaskStatus(outcome: string | undefined): AgentTaskEventPartData['status'] {
  if (outcome === 'completed') return 'completed'
  if (outcome === 'aborted' || outcome === 'stopped' || outcome === 'interrupted') return 'stopped'
  return 'error'
}
