import { Download } from 'lucide-react'
import { useEffect, useState } from 'react'

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Button,
  CircularProgress,
  Spinner
} from '@cherrystudio/ui'
import AppLogo from '@renderer/assets/images/logo.png'
import { LegacyUpgradeChannels, type LegacyInstallState, type LegacyUpgradeScreen } from '@shared/types/legacyUpgrade'

export default function LegacyUpgradeApp({ screen }: { screen: LegacyUpgradeScreen }) {
  const [busy, setBusy] = useState(false)
  const [state, setState] = useState<LegacyInstallState>({ phase: 'idle' })
  const install = screen.installation
  const active = !['idle', 'failed'].includes(state.phase)
  const locked = busy || active
  useEffect(() => {
    if (!install?.enabled) return
    let live = true
    let received = false
    const off = window.electron.ipcRenderer.on(LegacyUpgradeChannels.State, (_event, next: LegacyInstallState) => {
      received = true
      if (live) setState(next)
    })
    void window.electron.ipcRenderer
      .invoke(LegacyUpgradeChannels.GetState)
      .then((next: LegacyInstallState) => {
        if (live && !received) setState(next)
      })
      .catch(() => {
        if (live) setState({ phase: 'failed' })
      })
    return () => {
      live = false
      off()
    }
  }, [install?.enabled])

  const invoke = async (channel: string, target?: string) => {
    setBusy(true)
    try {
      await window.electron.ipcRenderer.invoke(channel, ...(target ? [target] : []))
    } catch {
      setState({ phase: 'failed' })
    } finally {
      setBusy(false)
    }
  }
  const primary = () => {
    if (install?.enabled) {
      setState({ phase: 'preparing' })
      void invoke(LegacyUpgradeChannels.Install)
    } else void invoke(LegacyUpgradeChannels.Download, install?.prerequisite ? 'prerequisite' : 'bridge')
  }
  const status =
    install &&
    (state.phase === 'cancelling' ? install.cancel : state.phase === 'idle' ? undefined : install[state.phase])

  return (
    <main className="flex h-screen flex-col bg-background text-foreground" data-testid="legacy-upgrade">
      <div className="h-6 shrink-0 [-webkit-app-region:drag]" aria-hidden="true" />
      <section className="min-h-0 flex-1 overflow-y-auto px-8 pb-4">
        <img src={AppLogo} alt="Cherry Studio" className="mb-6 size-10 [-webkit-app-region:drag]" />
        <h1 className="text-xl font-semibold tracking-tight">{screen.title}</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          {install?.prerequisite ? screen.prerequisite : install?.enabled ? install.detail : screen.detail}
        </p>
        {status && (
          <div className="mt-5 space-y-3" role="status" aria-live="polite">
            <p className="text-sm text-muted-foreground">{status}</p>
            {state.phase === 'downloading' &&
              (state.percent === undefined ? (
                <Spinner text={null} />
              ) : (
                <CircularProgress
                  value={state.percent}
                  size={48}
                  strokeWidth={3}
                  showLabel
                  renderLabel={(percent) => `${percent}%`}
                />
              ))}
          </div>
        )}
        {!active && (
          <Accordion type="single" collapsible className="mt-5">
            <AccordionItem value="older-versions" className="border-0 first:border-t-0">
              <AccordionTrigger className="py-2 text-sm font-normal text-muted-foreground">
                {screen.olderVersions}
              </AccordionTrigger>
              <AccordionContent className="pb-0">
                <p className="leading-relaxed">{screen.prerequisite}</p>
                <Button
                  variant="link"
                  className="mt-2 h-auto p-0"
                  disabled={locked}
                  onClick={() => void invoke(LegacyUpgradeChannels.Download, 'prerequisite')}>
                  {screen.downloadPrerequisite}
                </Button>
                {install?.enabled && (
                  <Button
                    variant="link"
                    className="mt-2 ms-4 h-auto p-0"
                    disabled={locked}
                    onClick={() => void invoke(LegacyUpgradeChannels.Download, 'bridge')}>
                    {screen.download}
                  </Button>
                )}
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        )}
      </section>
      <footer className="flex shrink-0 flex-wrap justify-end gap-3 px-8 pt-4 pb-8">
        {active && state.phase !== 'installing' ? (
          <Button
            variant="outline"
            disabled={busy || state.phase === 'cancelling'}
            onClick={() => void invoke(LegacyUpgradeChannels.Cancel)}>
            {install?.cancel}
          </Button>
        ) : (
          <Button
            variant="outline"
            disabled={busy || state.phase === 'installing'}
            onClick={() => void invoke(LegacyUpgradeChannels.Quit)}>
            {screen.quit}
          </Button>
        )}
        <Button disabled={locked} onClick={primary}>
          <Download size={16} />
          {install?.enabled
            ? state.phase === 'failed'
              ? install.retry
              : install.action
            : install?.prerequisite
              ? screen.downloadPrerequisite
              : screen.download}
        </Button>
      </footer>
    </main>
  )
}
