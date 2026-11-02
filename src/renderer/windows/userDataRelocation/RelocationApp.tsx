import { CircleCheck, Loader2, XCircle } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@cherrystudio/ui'
import { UserDataRelocationIpcChannels, type UserDataRelocationSupportLink } from '@shared/types/userDataRelocation'

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
  const [linkError, setLinkError] = useState<string | null>(null)
  const [copyError, setCopyError] = useState<string | null>(null)
  const openSupportLink = (purpose: UserDataRelocationSupportLink) => {
    void window.electron.ipcRenderer.invoke(UserDataRelocationIpcChannels.OpenSupportLink, purpose).then(
      (opened: unknown) => {
        setLinkError(opened === true ? null : t('relocation.support.open_failed'))
      },
      () => {
        setLinkError(t('relocation.support.open_failed'))
      }
    )
  }
  return (
    <div className="flex w-full flex-col items-center gap-3 text-center">
      <XCircle className="text-destructive" size={40} />
      <h2 className="text-base font-semibold text-foreground">{title}</h2>
      <p className="text-sm text-muted-foreground">{description}</p>
      {error && (
        <pre className="max-h-24 w-full overflow-auto rounded border border-border bg-background-subtle px-3 py-2 text-left text-xs break-words whitespace-pre-wrap text-foreground-tertiary">
          {error}
        </pre>
      )}
      <p className="text-xs text-muted-foreground">{t('relocation.support.analysis_unavailable')}</p>
      {linkError ? <p className="text-xs text-destructive">{linkError}</p> : null}
      {copyError ? <p className="text-xs text-destructive">{copyError}</p> : null}
      <div className="flex w-full flex-wrap justify-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            if (!error) return
            void navigator.clipboard.writeText(error).then(
              () => setCopyError(null),
              () => setCopyError(t('relocation.support.copy_failed'))
            )
          }}>
          {t('relocation.support.copy')}
        </Button>
        <Button variant="outline" size="sm" onClick={() => openSupportLink('feedback')}>
          {t('relocation.support.feedback')}
        </Button>
        <Button variant="outline" size="sm" onClick={() => openSupportLink('releases')}>
          {t('relocation.support.releases')}
        </Button>
      </div>
      <Button onClick={onRestart} className="mt-2 w-full">
        {buttonLabel}
      </Button>
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
