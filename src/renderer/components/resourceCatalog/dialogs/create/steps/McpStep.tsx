import { useEffect, useState } from 'react'
import { useWatch, type UseFormReturn } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { Button } from '@cherrystudio/ui'
import { dataApiService } from '@renderer/data/DataApiService'
import { preferenceService } from '@renderer/data/PreferenceService'
import type { McpServer } from '@shared/data/types/mcpServer'
import { isBrowserMcpServer } from '@shared/utils/mcp'

import { McpServerCatalogGrid } from '../../components/McpServerCatalogGrid'
import type { ResourceCreateWizardFormValues } from '../types'

export function McpStep({
  form,
  active,
  disabled,
  portalContainer
}: {
  form: UseFormReturn<ResourceCreateWizardFormValues>
  active: boolean
  disabled: boolean
  portalContainer: HTMLElement | null
}) {
  const { t } = useTranslation()
  const reviewedIds = useWatch({ control: form.control, name: 'reviewedMcpServerIds' })
  const [catalog, setCatalog] = useState<McpServer[] | undefined>()
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!active || reviewedIds !== undefined) return
    let cancelled = false
    setFailed(false)
    void Promise.all([
      preferenceService.getAuthoritative('assistant.default_mcp_server_ids'),
      dataApiService.get('/mcp-servers')
    ])
      .then(([ids, servers]) => {
        if (cancelled) return
        if (ids === undefined) {
          setFailed(true)
          return
        }
        const activeIds = new Set(
          servers.items.filter((server) => server.isActive && !isBrowserMcpServer(server)).map((server) => server.id)
        )
        setCatalog(servers.items)
        form.setValue(
          'reviewedMcpServerIds',
          [...new Set(ids)].filter((id) => activeIds.has(id))
        )
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [active, attempt, form, reviewedIds])

  if (reviewedIds === undefined) {
    return failed ? (
      <div role="alert" className="space-y-3">
        <p className="text-sm text-error">{t('assistant.mcp_defaults.load_failed')}</p>
        <Button type="button" variant="outline" onClick={() => setAttempt((value) => value + 1)}>
          {t('common.retry')}
        </Button>
      </div>
    ) : (
      <p role="status" className="text-sm text-muted-foreground">
        {t('common.loading')}
      </p>
    )
  }

  const selectedIds = reviewedIds
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t('assistant.mcp_defaults.description')}</p>
      <McpServerCatalogGrid
        servers={catalog}
        title={t('settings.mcp.title')}
        enabledIds={new Set(selectedIds)}
        disabled={disabled}
        emptyLabel={t('library.config.tools.empty_title')}
        portalContainer={portalContainer}
        onToggle={(id, enabled) => {
          if (disabled) return
          form.setValue(
            'reviewedMcpServerIds',
            enabled ? [...new Set([...selectedIds, id])] : selectedIds.filter((value) => value !== id),
            { shouldDirty: true }
          )
        }}
      />
    </div>
  )
}
