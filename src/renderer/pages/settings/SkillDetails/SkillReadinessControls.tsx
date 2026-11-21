import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@cherrystudio/ui'
import { ipcApi } from '@renderer/ipc'
import type { SkillReadiness, SkillSetupPlan } from '@shared/types/skillReadiness'

export function SkillReadinessControls({
  skillId,
  readiness: stored,
  onChange
}: {
  skillId: string
  readiness?: SkillReadiness
  onChange: () => void
}) {
  const { t } = useTranslation()
  const [readiness, setReadiness] = useState(stored)
  const [plan, setPlan] = useState<SkillSetupPlan | null>(null)
  const [planOpen, setPlanOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  useEffect(() => {
    setReadiness(stored)
  }, [stored])
  useEffect(() => {
    let active = true
    void ipcApi.request('skill.preflight', { skillId }).then(
      (result) => {
        if (active) {
          setReadiness(result)
          onChange()
        }
      },
      (error) => {
        if (active) setError(String(error))
      }
    )
    return () => {
      active = false
    }
    // Preflight once on entry, not on every projection notification.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skillId])
  const prepare = async () => {
    setBusy(true)
    setError(undefined)
    try {
      const checked = await ipcApi.request('skill.preflight', { skillId })
      setReadiness(checked)
      onChange()
      if (checked.state === 'ready') return
      setPlan(await ipcApi.request('skill.setup.plan', { skillId }))
      setPlanOpen(true)
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }
  const approve = async () => {
    if (!plan || !planOpen || busy) return
    const approvalId = plan.approvalId
    setPlanOpen(false)
    setBusy(true)
    setError(undefined)
    setReadiness((current) => (current ? { ...current, state: 'setting_up' } : current))
    try {
      setReadiness(await ipcApi.request('skill.setup.approve', { skillId, approvalId }))
      onChange()
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
      onChange()
    } finally {
      setBusy(false)
    }
  }
  const cancel = async () => {
    try {
      await ipcApi.request('skill.setup.cancel', { skillId })
      onChange()
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
    }
  }
  const state = readiness?.state
  return (
    <section
      className="shrink-0 space-y-2 rounded-lg border border-border p-3 text-sm"
      aria-label={t('settings.skills.readiness.title')}>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-medium">{t('settings.skills.readiness.title')}</h2>
        {state && <Badge variant="secondary">{t(`settings.skills.readiness.${state}`)}</Badge>}
        {state === 'setting_up' ? (
          <Button size="sm" variant="outline" onClick={() => void cancel()}>
            {t('common.cancel')}
          </Button>
        ) : state && state !== 'ready' ? (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void prepare()}>
            {t(state === 'failed' ? 'settings.skills.readiness.retry' : 'settings.skills.readiness.setup')}
          </Button>
        ) : null}
      </div>
      {!!readiness?.missing.length && (
        <ul className="list-inside list-disc text-muted-foreground">
          {readiness.missing.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )}
      {readiness?.warnings?.map((warning) => (
        <p key={warning} className="text-muted-foreground">
          {warning}
        </p>
      ))}
      {(error || readiness?.error) && (
        <p role="alert" className="break-words text-destructive">
          {error || readiness?.error}
        </p>
      )}
      {readiness?.logPath && (
        <p className="font-mono text-xs break-all text-muted-foreground">
          {t('settings.skills.readiness.log')}: {readiness.logPath}
        </p>
      )}
      <Dialog
        open={planOpen}
        onOpenChange={(open) => {
          setPlanOpen(open)
        }}>
        <DialogContent size="lg" closeLabel={t('common.close')} className="max-h-[80dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('settings.skills.readiness.approval')}</DialogTitle>
            <DialogDescription>{t('settings.skills.readiness.consent')}</DialogDescription>
          </DialogHeader>
          <p className="font-mono text-xs break-all">{plan?.directory}</p>
          <h3 className="font-medium">{t('settings.skills.readiness.packages')}</h3>
          <ul className="list-inside list-disc font-mono text-xs">
            {plan?.packages.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <h3 className="font-medium">{t('settings.skills.readiness.commands')}</h3>
          <pre className="overflow-x-auto rounded bg-secondary p-3 text-xs break-all whitespace-pre-wrap">
            {plan?.commands.map((command) => JSON.stringify([command.executable, ...command.args])).join('\n')}
          </pre>
          {plan?.warnings.map((warning) => (
            <p key={warning} className="text-sm text-muted-foreground">
              {warning}
            </p>
          ))}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPlanOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button disabled={busy} onClick={() => void approve()}>
              {t('settings.skills.readiness.approve')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
