import { Download, ShieldCheck } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Badge,
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Textarea
} from '@cherrystudio/ui'
import { SettingDescription, SettingGroup, SettingTitle } from '@renderer/components/SettingsPrimitives'
import { ipcApi } from '@renderer/ipc'
import type { UarCatalogSnapshot, UarCompilerResult } from '@shared/types/prometheusIntegration'

function downloadBundle(result: UarCompilerResult) {
  const bundle = { descriptor: result.descriptor, signature: result.signature, report: result.report }
  const url = URL.createObjectURL(new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${result.report.agentId}-signed-descriptor.json`
  anchor.click()
  URL.revokeObjectURL(url)
}

export function UarCompilerPanel() {
  const { t } = useTranslation()
  const tr = (key: string) => t(`settings.prometheus.integration.uarAdmin.compiler.${key}`)
  const [catalog, setCatalog] = useState<UarCatalogSnapshot>()
  const [content, setContent] = useState('')
  const [register, setRegister] = useState(false)
  const [replacementId, setReplacementId] = useState('none')
  const [result, setResult] = useState<UarCompilerResult>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  useEffect(() => {
    void ipcApi
      .request('prometheus.uar.catalog.read', {})
      .then(setCatalog)
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : String(loadError)))
  }, [])

  const compile = async () => {
    setBusy(true)
    setError(undefined)
    setResult(undefined)
    try {
      const replacement = catalog?.agents.find((agent) => agent.id === replacementId)
      setResult(
        await ipcApi.request('prometheus.uar.catalog.compile', {
          content,
          register,
          replace: Boolean(replacement),
          ...(replacement ? { expectedRevision: replacement.revision } : {})
        })
      )
    } catch (compileError) {
      setError(compileError instanceof Error ? compileError.message : String(compileError))
    } finally {
      setBusy(false)
    }
  }

  return (
    <SettingGroup>
      <SettingTitle>{tr('title')}</SettingTitle>
      <SettingDescription>{tr('description')}</SettingDescription>
      <div className="mt-5 space-y-4">
        <div className="space-y-1.5">
          <label className="text-sm font-medium" htmlFor="uar-agent-md">
            {tr('source')}
          </label>
          <Textarea.Input
            id="uar-agent-md"
            rows={18}
            value={content}
            onValueChange={setContent}
            disabled={busy}
            className="font-mono text-xs"
            placeholder={tr('sourcePlaceholder')}
          />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border p-3">
          <div>
            <div className="text-sm font-medium">{tr('register')}</div>
            <div className="text-xs text-muted-foreground">{tr('registerDescription')}</div>
          </div>
          <Switch checked={register} onCheckedChange={setRegister} disabled={busy} />
        </div>
        {register && (
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="uar-compiler-replace">
              {tr('collisionPolicy')}
            </label>
            <Select value={replacementId} onValueChange={setReplacementId}>
              <SelectTrigger id="uar-compiler-replace">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{tr('createOnly')}</SelectItem>
                {catalog?.agents.map((agent) => (
                  <SelectItem key={agent.id} value={agent.id}>
                    {tr('replace')} · {agent.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        {error && (
          <div className="rounded-lg border border-error-border bg-error-subtle p-3 text-sm text-error" role="alert">
            <div className="font-medium">{tr('failed')}</div>
            <div className="mt-1 break-words">{error}</div>
          </div>
        )}
        {result && (
          <div className="space-y-3 rounded-xl border border-border p-4" role="status">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="font-medium">{result.report.agentId}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {result.report.version} · {result.report.totalDurationMs} ms
                </div>
              </div>
              <div className="flex gap-2">
                <Badge variant={result.report.overall === 'pass' ? 'secondary' : 'outline'}>
                  {result.report.overall}
                </Badge>
                <Badge variant={result.verification.valid ? 'secondary' : 'outline'}>
                  <ShieldCheck size={13} aria-hidden="true" />
                  {result.verification.valid ? tr('signatureValid') : tr('signatureInvalid')}
                </Badge>
              </div>
            </div>
            <div className="divide-y divide-border-subtle rounded-lg border border-border">
              {result.report.stages.map((stage) => (
                <div key={stage.stage} className="flex flex-wrap items-start justify-between gap-2 p-2.5 text-sm">
                  <div>
                    <span className="font-medium">
                      {stage.stage}. {stage.name}
                    </span>
                    {stage.diagnostics.map((diagnostic, index) => (
                      <div key={`${diagnostic.level}-${index}`} className="mt-1 text-xs text-muted-foreground">
                        {diagnostic.level}: {diagnostic.message}
                      </div>
                    ))}
                  </div>
                  <Badge variant="outline">{stage.outcome}</Badge>
                </div>
              ))}
            </div>
            <div className="break-all text-xs text-muted-foreground">
              {tr('contentHash')}: {result.verification.contentHash}
            </div>
            <Button variant="outline" size="sm" onClick={() => downloadBundle(result)}>
              <Download size={14} aria-hidden="true" /> {tr('exportSigned')}
            </Button>
          </div>
        )}
        <div className="flex justify-end">
          <Button onClick={() => void compile()} disabled={busy || !content.trim()}>
            {busy ? tr('compiling') : register ? tr('compileRegister') : tr('compile')}
          </Button>
        </div>
      </div>
    </SettingGroup>
  )
}
