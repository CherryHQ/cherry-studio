import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Alert, Badge, Button } from '@cherrystudio/ui'
import { useDataChange, usePaginatedQuery } from '@data/hooks/useDataApi'
import {
  ResourceEditDialogHost,
  type ResourceEditDialogTarget
} from '@renderer/components/resourceCatalog/dialogs/edit'
import { SettingsContentColumn, SettingTitle } from '@renderer/components/SettingsPrimitives'
import { AGENT_HOOK_EVENT_LABEL_KEYS } from '@renderer/utils/agent/agentHookLabels'
import { AGENT_RUNTIME_CAPABILITIES } from '@shared/ai/agentRuntimeCapabilities'
import { AGENTS_MAX_LIMIT } from '@shared/data/api/schemas/agents'

export function HooksSettings() {
  const { t } = useTranslation()
  const [editTarget, setEditTarget] = useState<ResourceEditDialogTarget | null>(null)
  const {
    items: agents,
    total,
    page,
    isLoading,
    isRefreshing,
    error,
    hasNext,
    hasPrev,
    nextPage,
    prevPage,
    refresh
  } = usePaginatedQuery('/agents', { limit: AGENTS_MAX_LIMIT, swrOptions: { keepPreviousData: false } })
  useDataChange('/agents', () => void refresh())
  const configuredAgents = agents.filter((agent) => agent.configuration?.hooks?.length)

  return (
    <SettingsContentColumn>
      <div className="space-y-4">
        <SettingTitle>
          {t('settings.hooks.title')}
          <Button variant="outline" size="sm" disabled={isLoading || isRefreshing} onClick={() => void refresh()}>
            {t('common.refresh')}
          </Button>
        </SettingTitle>
        <p className="text-muted-foreground text-sm">{t('settings.hooks.description')}</p>
        {error ? (
          <Alert
            type="error"
            message={t('common.error')}
            action={
              <Button variant="outline" size="sm" onClick={() => void refresh()}>
                {t('common.retry')}
              </Button>
            }
          />
        ) : isLoading ? (
          <p role="status" className="py-8 text-center text-muted-foreground text-sm">
            {t('common.loading')}
          </p>
        ) : configuredAgents.length === 0 ? (
          <p className="py-8 text-center text-muted-foreground text-sm">{t('settings.hooks.empty')}</p>
        ) : (
          configuredAgents.map((agent) => (
            <section key={agent.id} aria-label={agent.name} className="space-y-3 rounded-xl border border-border p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="break-words font-medium text-sm">{agent.name}</h2>
                  <p className="text-muted-foreground text-xs">{t(AGENT_RUNTIME_CAPABILITIES[agent.type].labelKey)}</p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setEditTarget({ kind: 'agent', id: agent.id, initialTab: 'hooks' })}>
                  {t('common.edit')}
                </Button>
              </div>
              <ul className="divide-y divide-border-subtle">
                {agent.configuration?.hooks?.map((hook) => (
                  <li key={hook.id} className="space-y-2 py-3 first:pt-0 last:pb-0">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="min-w-0 break-words font-medium">{hook.name || t('agent_hooks.title')}</span>
                      <Badge variant="secondary">{t(AGENT_HOOK_EVENT_LABEL_KEYS[hook.event])}</Badge>
                      <Badge variant={hook.enabled ? 'outline' : 'secondary'}>
                        {hook.enabled ? t('common.enabled') : t('common.disabled')}
                      </Badge>
                    </div>
                    {hook.matcher?.toolNameContains ? (
                      <p className="break-all text-muted-foreground text-xs">
                        {t('agent_hooks.matcher.tool_name')}: {hook.matcher.toolNameContains}
                      </p>
                    ) : null}
                    {hook.matcher?.inputContains ? (
                      <p className="break-all text-muted-foreground text-xs">
                        {t('agent_hooks.matcher.input')}: {hook.matcher.inputContains}
                      </p>
                    ) : null}
                    <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted/40 p-2 font-mono text-xs">
                      {hook.command}
                    </pre>
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
        {hasPrev || hasNext ? (
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Button variant="outline" size="sm" disabled={!hasPrev || isLoading} onClick={prevPage}>
              {t('common.previous')}
            </Button>
            <span className="text-muted-foreground text-xs">
              {t('settings.hooks.pagination', { page, pageCount: Math.max(page, Math.ceil(total / AGENTS_MAX_LIMIT)) })}
            </span>
            <Button variant="outline" size="sm" disabled={!hasNext || isLoading} onClick={nextPage}>
              {t('common.next')}
            </Button>
          </div>
        ) : null}
      </div>
      <ResourceEditDialogHost
        target={editTarget}
        onOpenChange={(open) => {
          if (!open) setEditTarget(null)
        }}
      />
    </SettingsContentColumn>
  )
}
