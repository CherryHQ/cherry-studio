import { Download } from 'lucide-react'
import { useState } from 'react'

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger, Button } from '@cherrystudio/ui'
import AppLogo from '@renderer/assets/images/logo.png'
import { LegacyUpgradeChannels, type LegacyUpgradeScreen } from '@shared/types/legacyUpgrade'

export default function LegacyUpgradeApp({ screen }: { screen: LegacyUpgradeScreen }) {
  const [busy, setBusy] = useState(false)
  const download = (target: 'bridge' | 'prerequisite') => {
    setBusy(true)
    void window.electron.ipcRenderer.invoke(LegacyUpgradeChannels.Download, target)
  }

  return (
    <main className="flex h-screen flex-col bg-background text-foreground" data-testid="legacy-upgrade">
      <div className="h-6 shrink-0 [-webkit-app-region:drag]" aria-hidden="true" />
      <section className="min-h-0 flex-1 overflow-y-auto px-8 pb-4">
        <img src={AppLogo} alt="Cherry Studio" className="mb-6 size-10 [-webkit-app-region:drag]" />
        <h1 className="text-xl font-semibold tracking-tight">{screen.title}</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{screen.detail}</p>
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
                disabled={busy}
                onClick={() => download('prerequisite')}>
                {screen.downloadPrerequisite}
              </Button>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </section>
      <footer className="flex shrink-0 flex-wrap justify-end gap-3 px-8 pt-4 pb-8">
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
    </main>
  )
}
