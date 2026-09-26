import { useVirtualizer } from '@tanstack/react-virtual'
import { RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Badge,
  Button,
  Checkbox,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch
} from '@cherrystudio/ui'
import { SettingDescription, SettingGroup, SettingTitle } from '@renderer/components/SettingsPrimitives'
import { ipcApi } from '@renderer/ipc'
import type { UarCatalogSnapshot } from '@shared/types/prometheusIntegration'

export function UarSkillsPanel() {
  const { t } = useTranslation()
  const tr = (key: string, options?: Record<string, unknown>) =>
    t(`settings.prometheus.integration.uarAdmin.skills.${key}`, options)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [snapshot, setSnapshot] = useState<UarCatalogSnapshot>()
  const [agentId, setAgentId] = useState<string>('none')
  const [bindings, setBindings] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState<string>()
  const [error, setError] = useState<string>()
  const [status, setStatus] = useState<string>()

  const load = useCallback(async () => {
    setBusy('load')
    setError(undefined)
    try {
      setSnapshot(await ipcApi.request('prometheus.uar.catalog.read', {}))
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError))
    } finally {
      setBusy(undefined)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const selectAgent = (id: string) => {
    setAgentId(id)
    setBindings(new Set(snapshot?.agents.find((agent) => agent.id === id)?.skillIds ?? []))
    setStatus(undefined)
  }

  const skills = snapshot?.skills ?? []
  const virtual = useVirtualizer({
    count: skills.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 72,
    overscan: 8
  })
  const virtualItems = virtual.getVirtualItems()
  const visibleSkills = useMemo(
    () => virtualItems.map((item) => ({ item, skill: skills[item.index] })),
    [skills, virtualItems]
  )

  const toggleGlobal = async (skillId: string, enabled: boolean) => {
    setBusy(skillId)
    setError(undefined)
    try {
      setSnapshot(await ipcApi.request('prometheus.uar.catalog.toggle_skill', { skillId, enabled }))
      setStatus(tr('updated'))
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : String(toggleError))
    } finally {
      setBusy(undefined)
    }
  }

  const saveBindings = async () => {
    if (agentId === 'none') return
    setBusy('bindings')
    setError(undefined)
    try {
      setSnapshot(
        await ipcApi.request('prometheus.uar.catalog.save_agent_skills', {
          agentId,
          skillIds: [...bindings]
        })
      )
      setStatus(tr('bindingsSaved'))
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError))
    } finally {
      setBusy(undefined)
    }
  }

  const refreshPack = async () => {
    setBusy('refresh')
    setError(undefined)
    try {
      setSnapshot(await ipcApi.request('prometheus.uar.catalog.refresh_skills', {}))
      setStatus(tr('refreshed'))
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : String(refreshError))
    } finally {
      setBusy(undefined)
    }
  }

  return (
    <SettingGroup>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <SettingTitle>{tr('title')}</SettingTitle>
          <SettingDescription>{tr('description')}</SettingDescription>
        </div>
        <Button variant="outline" size="sm" onClick={() => void refreshPack()} disabled={Boolean(busy)}>
          <RefreshCw className={busy === 'refresh' ? 'animate-spin' : ''} size={14} aria-hidden="true" />
          {tr('refreshPack')}
        </Button>
      </div>
      <div className="mt-4 flex flex-wrap gap-2 text-xs text-muted-foreground">
        <Badge variant="outline">{tr('loaded', { count: snapshot?.skillProvenance.loadedSkillCount ?? 0 })}</Badge>
        {snapshot?.skillProvenance.revision && (
          <Badge variant="outline">{snapshot.skillProvenance.revision.slice(0, 12)}</Badge>
        )}
        {snapshot?.skillProvenance.drift && <Badge variant="outline">{snapshot.skillProvenance.drift}</Badge>}
      </div>
      <div className="mt-4 space-y-1.5">
        <label className="text-sm font-medium" htmlFor="uar-skill-agent">
          {tr('agent')}
        </label>
        <Select value={agentId} onValueChange={selectAgent}>
          <SelectTrigger id="uar-skill-agent">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">{tr('noAgent')}</SelectItem>
            {snapshot?.agents.map((agent) => (
              <SelectItem key={agent.id} value={agent.id}>
                {agent.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {error && (
        <div className="mt-4 rounded-lg border border-error-border bg-error-subtle p-3 text-sm text-error" role="alert">
          {error}
        </div>
      )}
      {status && (
        <div className="mt-4 rounded-lg border border-success/30 bg-success/10 p-3 text-sm text-success" role="status">
          {status}
        </div>
      )}
      <div ref={scrollRef} className="relative mt-4 h-[34rem] overflow-auto rounded-xl border border-border">
        <div style={{ height: virtual.getTotalSize(), position: 'relative' }}>
          {visibleSkills.map(({ item, skill }) => (
            <div
              key={skill.id}
              className="absolute left-0 top-0 flex w-full items-center gap-3 border-b border-border-subtle p-3"
              style={{ transform: `translateY(${item.start}px)`, height: item.size }}>
              <Checkbox
                checked={bindings.has(skill.id)}
                disabled={agentId === 'none' || Boolean(busy)}
                aria-label={tr('bindSkill', { skill: skill.title })}
                onCheckedChange={(checked) =>
                  setBindings((current) => {
                    const next = new Set(current)
                    if (checked === true) next.add(skill.id)
                    else next.delete(skill.id)
                    return next
                  })
                }
              />
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-sm font-medium">{skill.title}</span>
                  <Badge variant="outline">{skill.origin}</Badge>
                </div>
                <div className="mt-1 truncate text-xs text-muted-foreground" title={skill.description}>
                  {skill.description}
                </div>
              </div>
              <Switch
                checked={skill.enabled}
                disabled={Boolean(busy)}
                aria-label={tr('enableSkill', { skill: skill.title })}
                onCheckedChange={(enabled) => void toggleGlobal(skill.id, enabled)}
              />
            </div>
          ))}
        </div>
        {!busy && skills.length === 0 && <div className="p-4 text-sm text-muted-foreground">{tr('empty')}</div>}
      </div>
      <div className="mt-4 flex justify-end">
        <Button onClick={() => void saveBindings()} disabled={agentId === 'none' || Boolean(busy)}>
          {busy === 'bindings' ? tr('savingBindings') : tr('saveBindings')}
        </Button>
      </div>
    </SettingGroup>
  )
}
