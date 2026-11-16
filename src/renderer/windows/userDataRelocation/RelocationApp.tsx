import { AlertCircle, ChevronRight, CircleCheck, Loader2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { UserDataRelocationIpcChannels } from '@shared/types/userDataRelocation'
import type { SupportLinkPurpose } from '@shared/utils/officialLinks'

import { useRelocationProgress } from './hooks/useRelocationProgress'

const RelocationApp = () => {
  const { t } = useTranslation()
  const { progress, restart } = useRelocationProgress()
  const stage = progress?.stage

  return (
    <div className="flex h-screen w-screen flex-col bg-background text-foreground">
      <header className="relative flex h-11 shrink-0 items-center justify-center border-b border-border [-webkit-app-region:drag]">
        <h1 className="text-sm font-medium text-foreground">{t('relocation.title')}</h1>
      </header>

      <main className="flex min-h-0 flex-1 justify-center overflow-y-auto px-8 py-6 [-webkit-app-region:no-drag]">
        <div className="flex min-h-full w-full max-w-[420px] flex-col">
          <div className="flex flex-1 flex-col items-center justify-center gap-4">
            {!progress && <Spinner label={t('relocation.preparing')} />}
            {stage === 'preparing' && <Spinner label={t('relocation.preparing')} />}
            {stage === 'copying' && progress && (
              <Copying label={t('relocation.copying')} copied={progress.bytesCopied} total={progress.bytesTotal} />
            )}
            {stage === 'committing' && <Spinner label={t('relocation.committing')} />}
            {stage === 'completed' && (
              <Completion
                title={t('relocation.completed.title')}
                description={t('relocation.completed.description')}
                buttonLabel={t('relocation.restart_success')}
                onRestart={restart}
              />
            )}
            {stage === 'failed' && (
              <Failure
                title={t('relocation.failed.title')}
                description={t('relocation.failed.description')}
                buttonLabel={t('relocation.restart_failure')}
                error={progress?.error}
                onRestart={restart}
              />
            )}
          </div>

          {progress && (
            <Paths
              fromLabel={t('relocation.from')}
              toLabel={t('relocation.to')}
              from={progress.from}
              to={progress.to}
            />
          )}
        </div>
      </main>
    </div>
  )
}

const Spinner = ({ label }: { label: string }) => (
  <div className="flex flex-col items-center gap-3 text-center">
    <Loader2 className="animate-spin text-foreground-tertiary" size={28} />
    <p className="text-sm text-muted-foreground">{label}</p>
  </div>
)

const Copying = ({ label, copied, total }: { label: string; copied: number; total: number }) => {
  const hasTotal = total > 0
  const percent = hasTotal ? Math.min(100, Math.max(0, Math.round((copied / total) * 100))) : 0

  return (
    <div className="flex w-full max-w-[360px] flex-col items-center gap-3">
      <p className="text-sm text-muted-foreground">{label}</p>
      <div className="h-2 w-full overflow-hidden rounded-full bg-border">
        {hasTotal ? (
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-200"
            style={{ width: `${percent}%` }}
          />
        ) : (
          <div className="h-full w-1/3 animate-pulse rounded-full bg-primary" />
        )}
      </div>
      <span className="min-h-4 text-xs text-foreground-tertiary">{hasTotal ? `${percent}%` : ''}</span>
    </div>
  )
}

const Failure = ({
  title,
  description,
  buttonLabel,
  error,
  onRestart
}: {
  title: string
  description: string
  buttonLabel: string
  error?: string
  onRestart: () => void
}) => {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const [copied, setCopied] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const openSupportLink = (purpose: SupportLinkPurpose) => {
    setCopied(false)
    void window.electron.ipcRenderer.invoke(UserDataRelocationIpcChannels.OpenSupportLink, purpose).then(
      (opened: unknown) => {
        setActionError(opened === true ? null : t('relocation.support.open_failed'))
      },
      () => {
        setActionError(t('relocation.support.open_failed'))
      }
    )
  }
  const copyError = () => {
    if (!error) return
    setCopied(false)
    void navigator.clipboard.writeText(error).then(
      () => {
        setActionError(null)
        setCopied(true)
      },
      () => setActionError(t('relocation.support.copy_failed'))
    )
  }
  const links = [
    ...(error ? [{ label: t('relocation.support.copy'), onClick: copyError }] : []),
    { label: t('relocation.support.feedback'), onClick: () => openSupportLink('feedback') },
    { label: t('relocation.support.download'), onClick: () => openSupportLink('download') }
  ]

  return (
    <div
      role="alert"
      className="group grid w-full grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-0.5 rounded-lg border border-border-subtle bg-background-subtle px-3 py-2.5 text-foreground">
      <AlertCircle size={14} className="mt-[3px] text-error" />
      <h2 className="font-medium text-[13px] leading-5">{title}</h2>
      <p className="col-start-2 text-muted-foreground text-xs leading-[18px]">{description}</p>
      <div className="col-start-2 mt-2 flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="rounded-[5px] text-muted-foreground hover:border-border-strong hover:bg-accent hover:text-foreground"
          onClick={onRestart}>
          {buttonLabel}
        </Button>
        <button
          type="button"
          aria-expanded={expanded}
          className="ml-auto inline-flex cursor-pointer items-center gap-0.5 text-foreground-tertiary text-xs hover:text-foreground group-hover:text-foreground"
          onClick={() => setExpanded((open) => !open)}>
          {t('relocation.support.details')}
          <ChevronRight className={cn('size-3.5 transition-transform', expanded && 'rotate-90')} aria-hidden />
        </button>
      </div>
      {expanded ? (
        <div className="col-start-2 mt-2 flex flex-col gap-1.5 border-border-subtle border-t pt-2">
          {error ? (
            <p className="line-clamp-3 select-text break-all font-mono text-[11px] text-muted-foreground leading-4">
              {error}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-foreground-tertiary text-xs">
            {links.map((link) => (
              <button
                key={link.label}
                type="button"
                className="cursor-pointer hover:text-foreground"
                onClick={link.onClick}>
                {link.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {actionError ? <p className="col-start-2 mt-1 text-muted-foreground text-xs">{actionError}</p> : null}
      {copied ? (
        <p role="status" className="col-start-2 mt-1 text-muted-foreground text-xs">
          {t('relocation.support.copied')}
        </p>
      ) : null}
    </div>
  )
}

const Completion = ({
  title,
  description,
  buttonLabel,
  onRestart
}: {
  title: string
  description: string
  buttonLabel: string
  onRestart: () => void
}) => (
  <div className="flex w-full flex-col items-center gap-3 text-center">
    <CircleCheck className="text-success" size={40} />
    <h2 className="text-base font-semibold text-foreground">{title}</h2>
    <p className="text-sm text-muted-foreground">{description}</p>
    <Button onClick={onRestart} className="mt-2 w-full">
      {buttonLabel}
    </Button>
  </div>
)

const Paths = ({ fromLabel, toLabel, from, to }: { fromLabel: string; toLabel: string; from: string; to: string }) => (
  <div className="mt-4 flex flex-col gap-2 border-t border-border pt-4 text-xs">
    <PathRow label={fromLabel} value={from} />
    <PathRow label={toLabel} value={to} />
  </div>
)

const PathRow = ({ label, value }: { label: string; value: string }) => (
  <div className="flex flex-col gap-0.5">
    <span className="font-medium text-muted-foreground">{label}</span>
    <span className="break-all text-foreground-tertiary">{value}</span>
  </div>
)

export default RelocationApp
