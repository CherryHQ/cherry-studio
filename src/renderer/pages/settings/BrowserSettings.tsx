import {
  Button,
  Checkbox,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch
} from '@cherrystudio/ui'
import { useMutation, useQuery } from '@data/hooks/useDataApi'
import { useDataChange } from '@data/hooks/useDataChange'
import { usePreference } from '@data/hooks/usePreference'
import {
  SettingDescription,
  SettingDivider,
  SettingGroup,
  SettingRow,
  SettingsContentColumn,
  SettingTitle
} from '@renderer/components/SettingsPrimitives'
import { ipcApi } from '@renderer/ipc'
import { popup } from '@renderer/services/popup'
import type { BrowserImportResult, BrowserImportSource } from '@shared/ipc/schemas/browserImport'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

const categoryLabels = {
  history: 'settings.browser.history',
  cookies: 'settings.browser.cookies',
  localStorage: 'settings.browser.localStorage',
  site_data: 'settings.browser.site_data',
  cache: 'settings.browser.cache'
} as const

export function BrowserSettings() {
  const { t } = useTranslation()
  const [enabled, setEnabled] = usePreference('app.browser.agent_control.enabled')
  const [search, setSearch] = useState('')
  const [offset, setOffset] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  const [sources, setSources] = useState<BrowserImportSource[]>([])
  const [panes, setPanes] = useState<{ sessionId: string; title: string }[]>([])
  const [paneId, setPaneId] = useState('')
  const [sourceId, setSourceId] = useState('file')
  const [domains, setDomains] = useState('')
  const [categories, setCategories] = useState({ history: false, cookies: true, localStorage: false })
  const [result, setResult] = useState<BrowserImportResult>()
  const {
    data,
    error: historyError,
    isLoading,
    refetch
  } = useQuery('/browser-visits', { query: { search, offset, limit: 25 } })
  const { trigger: deleteVisit } = useMutation('DELETE', '/browser-visits/:id')
  const { trigger: clearHistory } = useMutation('DELETE', '/browser-visits')
  useDataChange('/browser-visits', () => void refetch())

  const refreshSources = async () => {
    const [profiles, targets] = await Promise.all([
      ipcApi.request('browser.import.sources'),
      ipcApi.request('browser.pane.list')
    ])
    setSources(profiles)
    setPanes(targets)
    setPaneId((current) =>
      targets.some((target) => target.sessionId === current) ? current : (targets[0]?.sessionId ?? '')
    )
  }
  useEffect(() => {
    void refreshSources().catch(() => setError(true))
  }, [])

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true)
    setError(false)
    try {
      await action()
    } catch {
      setError(true)
    } finally {
      setBusy(false)
    }
  }
  const clear = async (kind: 'history' | 'site_data' | 'cache') => {
    const confirmed = await popup.confirm({
      title: t(categoryLabels[kind]),
      content: t(kind === 'site_data' ? 'settings.browser.clearSiteConfirm' : 'settings.browser.clearConfirm')
    })
    if (!confirmed) return
    await run(async () => {
      if (kind === 'history') {
        await clearHistory()
        setOffset(0)
        await refetch()
      } else await ipcApi.request('browser.data.clear', { kind })
    })
  }
  const importData = () =>
    run(async () => {
      setResult(undefined)
      const imported = await ipcApi.request('browser.import.run', {
        sourceId: sourceId === 'file' ? undefined : sourceId,
        ...categories,
        domains: domains
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean)
      })
      if (
        !imported.cancelled ||
        [imported.cookies, imported.history, imported.localStorage].some(
          (category) => category.imported || category.failed || category.skipped
        )
      ) {
        setResult(imported)
        if (imported.cancelled) setError(true)
        setOffset(0)
        await refetch()
      }
    })
  const selectedSource = sources.find((source) => source.id === sourceId)

  return (
    <SettingsContentColumn>
      <SettingGroup>
        <SettingTitle>{t('settings.browser.title')}</SettingTitle>
        <SettingDivider />
        <SettingRow>
          <Label htmlFor="browser-agent-control">{t('settings.browser.control')}</Label>
          <Switch
            id="browser-agent-control"
            checked={enabled}
            disabled={busy}
            onCheckedChange={(value) => void run(() => setEnabled(value))}
          />
        </SettingRow>
        <SettingDescription>{t('settings.browser.controlHelp')}</SettingDescription>
      </SettingGroup>
      {error && (
        <p role="alert" className="mb-4 text-error">
          {t('settings.browser.error')}
        </p>
      )}
      <SettingGroup className="flex flex-col gap-3">
        <SettingTitle>{t('settings.browser.import')}</SettingTitle>
        <SettingDescription>{t('settings.browser.importHelp')}</SettingDescription>
        <div className="flex gap-2">
          <Select
            value={sourceId}
            onValueChange={(value) => {
              setSourceId(value)
              setResult(undefined)
              setCategories({ history: value !== 'file', cookies: value === 'file', localStorage: false })
            }}
            disabled={busy}>
            <SelectTrigger aria-label={t('settings.browser.source')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="file">{t('settings.browser.file')}</SelectItem>
              {sources.map((source) => (
                <SelectItem key={source.id} value={source.id}>
                  {source.browser} / {source.profile}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" disabled={busy} onClick={() => void run(refreshSources)}>
            {t('common.refresh')}
          </Button>
        </div>
        {selectedSource?.cookies === 'unencrypted_only' && (
          <SettingDescription>{t('settings.browser.encrypted')}</SettingDescription>
        )}
        <div className="flex flex-wrap gap-4">
          {(['history', 'cookies', 'localStorage'] as const).map((category) => (
            <div key={category} className="flex items-center gap-2">
              <Checkbox
                id={`browser-import-${category}`}
                checked={categories[category]}
                disabled={
                  busy ||
                  (category === 'history'
                    ? !selectedSource?.history
                    : category === 'localStorage'
                      ? sourceId !== 'file'
                      : selectedSource?.cookies === 'unavailable')
                }
                onCheckedChange={(checked) => setCategories((value) => ({ ...value, [category]: checked === true }))}
              />
              <Label htmlFor={`browser-import-${category}`}>{t(categoryLabels[category])}</Label>
            </div>
          ))}
        </div>
        <Label htmlFor="browser-import-domains">{t('settings.browser.domains')}</Label>
        <Input
          id="browser-import-domains"
          value={domains}
          onChange={(event) => setDomains(event.target.value)}
          disabled={busy}
        />
        <SettingDescription>{t('settings.browser.domainsHelp')}</SettingDescription>
        <Button
          className="self-start"
          disabled={busy || !Object.values(categories).some(Boolean)}
          onClick={() => void importData()}>
          {t(busy ? 'common.loading' : 'settings.browser.import')}
        </Button>
        {result && (
          <div role="status" className="space-y-1 text-sm">
            {(['history', 'cookies', 'localStorage'] as const).map((category) => (
              <p key={category}>
                {t(categoryLabels[category])}: {t('settings.browser.result', result[category])}
                {result[category].unsupported ? ` — ${t('settings.browser.unsupported')}` : ''}
              </p>
            ))}
          </div>
        )}
      </SettingGroup>
      <SettingGroup className="flex flex-col gap-3">
        <SettingTitle>{t('settings.browser.history')}</SettingTitle>
        <Input
          aria-label={t('settings.browser.search')}
          placeholder={t('settings.browser.search')}
          value={search}
          onChange={(event) => {
            setSearch(event.target.value)
            setOffset(0)
          }}
        />
        {panes.length > 0 ? (
          <Select value={paneId} onValueChange={setPaneId}>
            <SelectTrigger aria-label={t('settings.browser.destination')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {panes.map((pane) => (
                <SelectItem key={pane.sessionId} value={pane.sessionId}>
                  {pane.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <SettingDescription>{t('settings.browser.noPane')}</SettingDescription>
        )}
        {historyError ? (
          <p role="alert">
            {t('settings.browser.error')}{' '}
            <Button variant="ghost" onClick={() => void refetch()}>
              {t('common.refresh')}
            </Button>
          </p>
        ) : isLoading ? (
          <p>{t('common.loading')}</p>
        ) : !data?.items.length ? (
          <p className="text-muted-foreground">{t('settings.browser.empty')}</p>
        ) : (
          <ul className="divide-y divide-border">
            {data.items.map((visit) => (
              <li key={visit.id} className="flex items-center gap-2 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm" title={visit.title}>
                    {visit.title || visit.url}
                  </p>
                  <p className="truncate text-muted-foreground text-xs" title={visit.url}>
                    {visit.url}
                  </p>
                  <p className="text-muted-foreground text-xs">{new Date(visit.visitedAt).toLocaleString()}</p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy || !paneId}
                  onClick={() =>
                    void run(() => ipcApi.request('browser.pane.open', { sessionId: paneId, url: visit.url }))
                  }>
                  {t('common.open')}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await deleteVisit({ params: { id: visit.id } })
                      await refetch()
                    })
                  }>
                  {t('common.delete')}
                </Button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex justify-between gap-2">
          <Button
            variant="outline"
            disabled={offset === 0 || busy}
            onClick={() => setOffset((value) => Math.max(0, value - 25))}>
            {t('common.previous')}
          </Button>
          <Button variant="outline" disabled={!data?.hasMore || busy} onClick={() => setOffset((value) => value + 25)}>
            {t('common.next')}
          </Button>
        </div>
        <Button
          variant="outline"
          className="self-start"
          disabled={busy || !data?.items.length}
          onClick={() => void clear('history')}>
          {t('settings.browser.clearHistory')}
        </Button>
      </SettingGroup>
      <SettingGroup className="flex flex-col gap-3">
        <SettingTitle>{t('settings.browser.site_data')}</SettingTitle>
        <SettingDescription>{t('settings.browser.clearSiteConfirm')}</SettingDescription>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={busy} onClick={() => void clear('site_data')}>
            {t('settings.browser.clearSite')}
          </Button>
          <Button variant="outline" disabled={busy} onClick={() => void clear('cache')}>
            {t('settings.browser.cache')}
          </Button>
        </div>
      </SettingGroup>
    </SettingsContentColumn>
  )
}
