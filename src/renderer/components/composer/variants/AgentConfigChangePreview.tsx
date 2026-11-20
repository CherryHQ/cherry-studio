import { ChevronRight, Loader2 } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { useTranslation } from 'react-i18next'
import useSWRImmutable from 'swr/immutable'

import { ResourceIdentityRow } from '@renderer/components/chat/messages/tools/agent'
import { ipcApi } from '@renderer/ipc'
import { cn } from '@renderer/utils/style'

/**
 * Approval body for an Agent or Assistant create or settings change, read from main: the new resource's
 * identity, or each changed field as `current → new`. The raw arguments stay one click away, and on
 * screen until the preview arrives or when it cannot be built.
 */
export function AgentConfigChangePreview({ approvalId, args }: { approvalId: string; args: ReactNode }) {
  const { t } = useTranslation()
  const [showArgs, setShowArgs] = useState(false)
  const [showFull, setShowFull] = useState(false)
  // One fetch per approval: a later approval gets its own key, so it never shows stale "current" values.
  const { data, error } = useSWRImmutable(['ai.agent.preview_config_change', approvalId], () =>
    ipcApi.request('ai.agent.preview_config_change', { approvalId })
  )

  if (!data?.ok) {
    return (
      <div data-testid="agent-config-change-preview">
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
        {args}
      </div>
    )
  }

  const { resource, summary = [], details = [] } = data
  return (
    <div data-testid="agent-config-change-preview">
      {resource ? (
        <ResourceIdentityRow
          kind={resource.kind}
          name={resource.name}
          emoji={resource.emoji}
          meta={[resource.description, ...resource.highlights].filter(Boolean).join(' · ')}
        />
      ) : (
        <>
          <div className="font-medium text-muted-foreground text-xs">
            {t('agent.toolPermission.agent_config.changes')}
          </div>
          <ul className="mt-1 space-y-1">
            {summary.map((line) => (
              <li key={line} className="break-words text-foreground text-xs leading-4">
                {line}
              </li>
            ))}
          </ul>
          {details.length ? (
            <>
              <button
                type="button"
                aria-expanded={showFull}
                className="mt-2 flex items-center gap-1 text-muted-foreground text-xs hover:text-foreground"
                onClick={() => setShowFull((shown) => !shown)}>
                <ChevronRight
                  aria-hidden="true"
                  className={cn('size-3 transition-transform', showFull && 'rotate-90')}
                />
                {t('agent.toolPermission.agent_config.full_text')}
              </button>
              {showFull
                ? details.map(({ field, from, to }) => (
                    <div key={field} className="mt-1.5 space-y-1 text-xs">
                      <div className="font-medium text-muted-foreground">{field}</div>
                      <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted px-2 py-1.5 text-muted-foreground line-through">
                        {from}
                      </pre>
                      <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted px-2 py-1.5 text-foreground">
                        {to}
                      </pre>
                    </div>
                  ))
                : null}
            </>
          ) : null}
        </>
      )}
      <button
        type="button"
        aria-expanded={showArgs}
        className="mt-2 flex items-center gap-1 text-muted-foreground text-xs hover:text-foreground"
        onClick={() => setShowArgs((shown) => !shown)}>
        <ChevronRight aria-hidden="true" className={cn('size-3 transition-transform', showArgs && 'rotate-90')} />
        {t('message.tools.sections.input')}
      </button>
      {showArgs ? args : null}
    </div>
  )
}
