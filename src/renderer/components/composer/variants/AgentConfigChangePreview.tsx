import { Loader2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import useSWRImmutable from 'swr/immutable'

import { ipcApi } from '@renderer/ipc'

/**
 * Approval body for an Agent settings change: each changed field as `current → new`, read from main.
 * Until that arrives, or when it cannot be built, the raw arguments stay on screen.
 */
export function AgentConfigChangePreview({ approvalId, fallback }: { approvalId: string; fallback: ReactNode }) {
  const { t } = useTranslation()
  // One fetch per approval: a later approval gets its own key, so it never shows stale "current" values.
  const { data, error } = useSWRImmutable(['ai.agent.preview_config_update', approvalId], () =>
    ipcApi.request('ai.agent.preview_config_update', { approvalId })
  )

  if (data?.ok) {
    return (
      <div className="mt-2" data-testid="agent-config-change-preview">
        <div className="font-medium text-muted-foreground text-xs">
          {t('agent.toolPermission.agent_config.changes')}
        </div>
        <ul className="mt-1 space-y-1">
          {data.summary.map((line) => (
            <li key={line} className="break-words text-foreground text-xs leading-4">
              {line}
            </li>
          ))}
        </ul>
      </div>
    )
  }

  return (
    <div className="mt-2" data-testid="agent-config-change-preview">
      <div className="flex items-center gap-1.5 text-muted-foreground text-xs">
        {error || data ? (
          t('agent.toolPermission.agent_config.error')
        ) : (
          <>
            <Loader2 aria-hidden="true" className="size-3 animate-spin" />
            {t('agent.toolPermission.agent_config.loading')}
          </>
        )}
      </div>
      {fallback}
    </div>
  )
}
