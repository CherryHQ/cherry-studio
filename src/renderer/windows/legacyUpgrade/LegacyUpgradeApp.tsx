import { ArrowRight, Download, ShieldCheck } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@cherrystudio/ui'
import AppLogo from '@renderer/assets/images/logo.png'
import { LegacyUpgradeChannels, type LegacyUpgradeScreen } from '@shared/types/legacyUpgrade'

export default function LegacyUpgradeApp({ screen }: { screen: LegacyUpgradeScreen }) {
  const [busy, setBusy] = useState(false)
  const download = (target: 'bridge' | 'prerequisite') => {
    setBusy(true)
    void window.electron.ipcRenderer.invoke(LegacyUpgradeChannels.Download, target)
  }

  return (
    <main className="flex min-h-screen flex-col bg-background text-foreground" data-testid="legacy-upgrade">
      <header className="flex items-center gap-3 border-b border-border px-8 py-5">
        <img src={AppLogo} alt="" className="size-9" />
        <span className="text-base font-semibold">Cherry Studio</span>
      </header>
      <section className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-8 py-7">
        <div>
          <div className="mb-4 flex size-11 items-center justify-center rounded-xl bg-background-subtle">
            <ShieldCheck size={24} className="text-muted-foreground" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">{screen.title}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{screen.message}</p>
        </div>
        <div className="flex items-center gap-4 text-sm" aria-hidden="true">
          <span className="rounded-md border border-border px-3 py-2">1.9.x</span>
          <ArrowRight size={16} className="text-muted-foreground" />
          <span className="rounded-md bg-primary px-3 py-2 font-medium text-primary-foreground">2.1.0</span>
          <ArrowRight size={16} className="text-muted-foreground" />
          <img src={AppLogo} alt="" className="size-7" />
        </div>
        <p className="whitespace-pre-line break-words text-sm leading-relaxed text-muted-foreground">{screen.detail}</p>
        <div className="rounded-lg border border-border bg-background-subtle p-4">
          <p className="text-sm leading-relaxed text-muted-foreground">{screen.prerequisite}</p>
          <Button variant="link" className="mt-2 h-auto p-0" disabled={busy} onClick={() => download('prerequisite')}>
            {screen.downloadPrerequisite}
          </Button>
        </div>
        <footer className="mt-auto flex justify-end gap-3 pt-2">
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => void window.electron.ipcRenderer.invoke(LegacyUpgradeChannels.Quit)}>
            {screen.quit}
          </Button>
          <Button disabled={busy} onClick={() => download('bridge')}>
            <Download size={16} />
            {screen.download}
          </Button>
        </footer>
      </section>
    </main>
  )
}
