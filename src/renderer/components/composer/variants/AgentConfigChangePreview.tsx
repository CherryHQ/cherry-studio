import { Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import useSWRImmutable from 'swr/immutable'

import { ipcApi } from '@renderer/ipc'

type PreviewRequest =
  | { tool: 'update_agent'; input: unknown }
  | { tool: 'config_update'; sessionId: string; input: unknown }

/** Approval body for an Agent settings change: each changed field as `current → new`, read from main. */
export function AgentConfigChangePreview({ request }: { request: PreviewRequest }) {
  const { t } = useTranslation()
  const { data, error } = useSWRImmutable(['ai.agent.preview_config_update', JSON.stringify(request)], () =>
    ipcApi.request('ai.agent.preview_config_update', request)
  )

  const failure = error
    ? String(error instanceof Error ? error.message : error)
    : data?.ok === false
      ? data.error
      : null

  return (
    <div className="mt-2" data-testid="agent-config-change-preview">
      <div className="font-medium text-muted-foreground text-xs">{t('agent.toolPermission.agent_config.changes')}</div>
      {failure ? (
        <div className="mt-1 break-words text-destructive text-xs leading-4">
          {t('agent.toolPermission.agent_config.error', { error: failure })}
        </div>
      ) : data?.ok ? (
        <ul className="mt-1 space-y-1">
          {data.summary.map((line) => (
            <li key={line} className="break-words text-foreground text-xs leading-4">
              {line}
            </li>
          ))}
        </ul>
      ) : (
        <div className="mt-1 flex items-center gap-1.5 text-muted-foreground text-xs">
          <Loader2 aria-hidden="true" className="size-3 animate-spin" />
          {t('agent.toolPermission.agent_config.loading')}
        </div>
      )}
    </div>
  )
}
