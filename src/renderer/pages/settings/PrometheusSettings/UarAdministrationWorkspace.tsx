import { useNavigate, useSearch } from '@tanstack/react-router'
import { CheckCircle2, CircleSlash2, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Badge,
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton
} from '@cherrystudio/ui'
import { SettingDescription, SettingGroup, SettingTitle } from '@renderer/components/SettingsPrimitives'
import { ipcApi } from '@renderer/ipc'
import { getSettingDomId } from '@renderer/pages/settings/settingsSearch/types'
import type { UarAdministrationSnapshot } from '@shared/types/prometheusIntegration'

import { UarAgentsPanel } from './UarAgentsPanel'
import { UarCompilerPanel } from './UarCompilerPanel'
import { UarProvidersModelsPanel } from './UarProvidersModelsPanel'
import { UarRuntimeSettingsPanel } from './UarRuntimeSettingsPanel'
import { UarSkillsPanel } from './UarSkillsPanel'

const GROUPS = ['runtime', 'agents', 'experience', 'administration'] as const

type SurfaceProjection = UarAdministrationSnapshot['surfaces'][number]
const EMPTY_SURFACES: UarAdministrationSnapshot['surfaces'] = []

function navText(translate: ReturnType<typeof useTranslation>['t'], key: string) {
  return translate('settings.prometheus.integration.uarAdmin.' + key)
}

function SurfaceStatus({ surface }: { surface: SurfaceProjection }) {
  const { t } = useTranslation()
  const available = surface.availability === 'available'
  return (
    <Badge variant={available ? 'secondary' : 'outline'} className="shrink-0 font-normal">
      {navText(t, `availability.${surface.availability}`)}
    </Badge>
  )
}

function MethodCoverage({ surface }: { surface: SurfaceProjection }) {
  const { t } = useTranslation()
  return (
    <details className="border-t border-border pt-4">
      <summary className="cursor-pointer text-sm font-medium text-foreground focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {navText(t, 'apiCoverage')} · {surface.methods.length}
      </summary>
      <div className="mt-3 divide-y divide-border-subtle overflow-hidden rounded-lg border border-border">
        {surface.methods.map((method) => (
          <div key={method.id} className="grid min-w-0 gap-2 px-3 py-2.5 sm:grid-cols-[4rem_minmax(0,1fr)_auto]">
            <span className="font-mono text-xs font-medium text-foreground">{method.method}</span>
            <code className="min-w-0 break-all text-xs text-muted-foreground">{method.path}</code>
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <Badge variant="outline" className="font-normal">
                {navText(t, `scope.${method.scope}`)}
              </Badge>
              <Badge variant="outline" className="font-normal">
                {navText(t, `apply.${method.apply}`)}
              </Badge>
              <span
                className={method.adapter === 'available' ? 'text-success' : 'text-error'}
                title={navText(t, `adapter.${method.adapter}`)}>
                {method.adapter === 'available' ? (
                  <CheckCircle2 size={15} aria-hidden="true" />
                ) : (
                  <CircleSlash2 size={15} aria-hidden="true" />
                )}
                <span className="sr-only">{navText(t, `adapter.${method.adapter}`)}</span>
              </span>
            </div>
          </div>
        ))}
      </div>
    </details>
  )
}

function CapabilitySurface({ surface }: { surface: SurfaceProjection }) {
  const { t } = useTranslation()
  const adapterFailures = surface.methods.filter((method) => method.adapter === 'unavailable').length
  return (
    <SettingGroup id={getSettingDomId('/settings/uar', surface.id)} className="min-w-0 scroll-mt-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <SettingTitle>{navText(t, `surface.${surface.id}`)}</SettingTitle>
          <SettingDescription>{navText(t, 'surfaceDescription')}</SettingDescription>
        </div>
        <SurfaceStatus surface={surface} />
      </div>
      {adapterFailures > 0 && (
        <div
          className="mt-4 rounded-lg border border-error-border bg-error-subtle px-3 py-2 text-sm text-error-subtle-foreground"
          role="alert">
          {navText(t, 'adapterMismatch')}
        </div>
      )}
      <div className="mt-4">
        <MethodCoverage surface={surface} />
      </div>
    </SettingGroup>
  )
}

function LoadingWorkspace() {
  return (
    <div className="grid gap-4 lg:grid-cols-[13rem_minmax(0,1fr)]" aria-busy="true">
      <div className="hidden space-y-2 lg:block">
        {Array.from({ length: 8 }, (_, index) => (
          <Skeleton key={index} className="h-8 rounded-md" />
        ))}
      </div>
      <Skeleton className="h-64 rounded-xl" />
    </div>
  )
}

export function UarAdministrationWorkspace({ overview }: { overview: ReactNode }) {
  const { t } = useTranslation()
  const navigate = useNavigate({ from: '/settings/uar' })
  const search = useSearch({ from: '/settings/uar' })
  const [snapshot, setSnapshot] = useState<UarAdministrationSnapshot>()
  const [error, setError] = useState<string>()
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    setError(undefined)
    try {
      setSnapshot(await ipcApi.request('prometheus.uar.admin.snapshot', {}))
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const surfaces = snapshot?.surfaces ?? EMPTY_SURFACES
  const requestedPanel = typeof search.panel === 'string' ? search.panel : undefined
  const selectedId = surfaces.some((surface) => surface.id === requestedPanel) ? requestedPanel! : 'overview'
  const selected = surfaces.find((surface) => surface.id === selectedId)
  const grouped = useMemo(
    () => GROUPS.map((group) => ({ group, surfaces: surfaces.filter((surface) => surface.group === group) })),
    [surfaces]
  )
  const selectSurface = (panel: string) => {
    void navigate({ search: (previous) => ({ ...previous, panel }), replace: false })
  }

  if (loading) return <LoadingWorkspace />
  if (error || !snapshot) {
    return (
      <SettingGroup>
        <SettingTitle>{navText(t, 'loadFailed')}</SettingTitle>
        <SettingDescription>{error ?? navText(t, 'loadFailedDescription')}</SettingDescription>
        <Button variant="outline" size="sm" className="mt-4" onClick={() => void load()}>
          <RefreshCw size={14} aria-hidden="true" />
          {navText(t, 'retry')}
        </Button>
      </SettingGroup>
    )
  }

  return (
    <div className="min-w-0">
      <div className="mb-4 lg:hidden">
        <Select value={selectedId} onValueChange={selectSurface}>
          <SelectTrigger aria-label={navText(t, 'destination')} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {grouped.flatMap(({ group, surfaces: groupSurfaces }) =>
              groupSurfaces.map((surface) => (
                <SelectItem key={surface.id} value={surface.id}>
                  {navText(t, `group.${group}`)} · {navText(t, `surface.${surface.id}`)}
                </SelectItem>
              ))
            )}
          </SelectContent>
        </Select>
      </div>
      <div className="grid min-w-0 gap-5 lg:grid-cols-[13rem_minmax(0,1fr)]">
        <nav className="hidden min-w-0 border-r border-border pr-3 lg:block" aria-label={navText(t, 'destination')}>
          {grouped.map(({ group, surfaces: groupSurfaces }) => (
            <div key={group} className="mb-5 last:mb-0">
              <div className="mb-1.5 px-2 text-xs font-medium text-muted-foreground">
                {navText(t, `group.${group}`)}
              </div>
              <div className="space-y-0.5">
                {groupSurfaces.map((surface) => {
                  const active = surface.id === selectedId
                  return (
                    <button
                      key={surface.id}
                      type="button"
                      aria-current={active ? 'page' : undefined}
                      onClick={() => selectSurface(surface.id)}
                      className={`flex min-h-9 w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${
                        active
                          ? 'bg-accent text-foreground'
                          : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
                      }`}>
                      <span className="min-w-0 truncate">{navText(t, `surface.${surface.id}`)}</span>
                      {surface.availability !== 'available' && (
                        <CircleSlash2 size={14} className="shrink-0" aria-hidden="true" />
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </nav>
        <section className="min-w-0" aria-live="polite">
          {selectedId === 'overview' ? (
            <>
              {overview}
              {selected && <CapabilitySurface surface={selected} />}
            </>
          ) : selectedId === 'runtime-settings' ? (
            <UarRuntimeSettingsPanel />
          ) : selectedId === 'providers-models' ? (
            <UarProvidersModelsPanel />
          ) : selectedId === 'agents' ? (
            <UarAgentsPanel />
          ) : selectedId === 'compiler' ? (
            <UarCompilerPanel />
          ) : selectedId === 'skills' ? (
            <UarSkillsPanel />
          ) : selected ? (
            <CapabilitySurface surface={selected} />
          ) : (
            <LoadingWorkspace />
          )}
        </section>
      </div>
      <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
        {navText(t, 'runtimeVersion')} {snapshot.uarVersion}
      </div>
    </div>
  )
}
