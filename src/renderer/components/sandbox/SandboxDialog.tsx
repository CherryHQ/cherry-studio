import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Label,
  Textarea
} from '@cherrystudio/ui'
import { ipcApi } from '@renderer/ipc'

export default function SandboxDialog({
  open,
  onOpenChange
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const [code, setCode] = useState('console.log(JSON.stringify({ node: process.versions.node, cwd: process.cwd() }))')
  const [busy, setBusy] = useState<'probe' | 'run' | null>(null)
  const [result, setResult] = useState('')

  async function execute(action: 'probe' | 'run') {
    setBusy(action)
    setResult('')
    try {
      if (action === 'probe') {
        setResult((await ipcApi.request('sandbox.probe')).report)
      } else {
        const output = await ipcApi.request('sandbox.run', { code, timeoutMs: 30000 })
        setResult([output.stdout, output.stderr, output.report].filter(Boolean).join('\n'))
      }
    } catch (error) {
      setResult(String(error))
    } finally {
      setBusy(null)
    }
  }

  async function stop() {
    try {
      await ipcApi.request('sandbox.stop')
    } catch (error) {
      setResult(String(error))
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && busy === 'run') void stop().then(() => onOpenChange(false))
        else onOpenChange(next)
      }}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('settings.about.sandbox.title')}</DialogTitle>
          <DialogDescription>{t('settings.about.sandbox.description')}</DialogDescription>
        </DialogHeader>
        <Label htmlFor="sandbox-code">{t('settings.about.sandbox.code')}</Label>
        <Textarea.Input
          id="sandbox-code"
          className="min-h-32 font-mono"
          value={code}
          onValueChange={setCode}
          maxLength={32768}
          disabled={busy !== null}
          spellCheck={false}
        />
        <div className="flex gap-2">
          <Button variant="outline" disabled={busy !== null} onClick={() => void execute('probe')}>
            {t('settings.about.sandbox.probe')}
          </Button>
          <Button disabled={busy !== null || !code.trim()} onClick={() => void execute('run')}>
            {t('settings.about.sandbox.run')}
          </Button>
          <Button variant="outline" disabled={busy !== 'run'} onClick={() => void stop()}>
            {t('common.stop')}
          </Button>
        </div>
        <Label htmlFor="sandbox-result">{t('settings.about.sandbox.result')}</Label>
        <Textarea.Input
          id="sandbox-result"
          className="min-h-48 font-mono text-xs"
          value={result}
          readOnly
          aria-live="polite"
          aria-busy={busy !== null}
        />
      </DialogContent>
    </Dialog>
  )
}
