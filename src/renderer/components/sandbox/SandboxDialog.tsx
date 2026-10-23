import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea
} from '@cherrystudio/ui'
import { ipcApi } from '@renderer/ipc'
import type { InputFor, OutputFor } from '@shared/ipc/types'

import { sandboxExamples } from './sandboxExamples'

const groups = ['files', 'rpc', 'instances', 'network'] as const
const groupLabels = {
  files: 'settings.about.sandbox.diagnostics.files',
  rpc: 'settings.about.sandbox.diagnostics.rpc',
  instances: 'settings.about.sandbox.diagnostics.instances',
  network: 'settings.about.sandbox.diagnostics.network'
} as const
const groupDescriptions = {
  files: 'settings.about.sandbox.diagnostics.files_description',
  rpc: 'settings.about.sandbox.diagnostics.rpc_description',
  instances: 'settings.about.sandbox.diagnostics.instances_description',
  network: 'settings.about.sandbox.diagnostics.network_description'
} as const
const caseLabels = {
  'direct-write': 'settings.about.sandbox.diagnostics.cases.direct_write',
  'readonly-read': 'settings.about.sandbox.diagnostics.cases.readonly_read',
  'readonly-write': 'settings.about.sandbox.diagnostics.cases.readonly_write',
  'outside-read': 'settings.about.sandbox.diagnostics.cases.outside_read',
  'outside-write': 'settings.about.sandbox.diagnostics.cases.outside_write',
  cleanup: 'settings.about.sandbox.diagnostics.cases.cleanup',
  'nested-callback': 'settings.about.sandbox.diagnostics.cases.nested_callback',
  authorization: 'settings.about.sandbox.diagnostics.cases.authorization',
  'concurrent-requests': 'settings.about.sandbox.diagnostics.cases.concurrent_requests',
  'cancellation-recovery': 'settings.about.sandbox.diagnostics.cases.cancellation_recovery',
  'separate-grants': 'settings.about.sandbox.diagnostics.cases.separate_grants',
  'independent-stop': 'settings.about.sandbox.diagnostics.cases.independent_stop',
  'allowlisted-http': 'settings.about.sandbox.diagnostics.cases.allowlisted_http',
  'unlisted-port': 'settings.about.sandbox.diagnostics.cases.unlisted_port',
  'unlisted-host': 'settings.about.sandbox.diagnostics.cases.unlisted_host',
  'connect-policy': 'settings.about.sandbox.diagnostics.cases.connect_policy',
  'redirect-policy': 'settings.about.sandbox.diagnostics.cases.redirect_policy',
  'direct-bypass': 'settings.about.sandbox.diagnostics.cases.direct_bypass'
} as const
const statusLabels = {
  passed: 'settings.about.sandbox.diagnostics.passed',
  failed: 'settings.about.sandbox.diagnostics.failed',
  unsupported: 'settings.about.sandbox.diagnostics.unsupported',
  cancelled: 'settings.about.sandbox.diagnostics.cancelled',
  inconclusive: 'settings.about.sandbox.diagnostics.inconclusive'
} as const
const stepLabels = {
  policy: 'settings.about.sandbox.interactive.policy',
  request: 'settings.about.sandbox.interactive.request',
  callback: 'settings.about.sandbox.interactive.callback',
  'callback-result': 'settings.about.sandbox.interactive.callback_result',
  response: 'settings.about.sandbox.interactive.response',
  error: 'settings.about.sandbox.interactive.error',
  cleanup: 'settings.about.sandbox.diagnostics.cases.cleanup'
} as const
type Group = (typeof groups)[number]
type CaseResult = OutputFor<'sandbox.diagnose'>['results'][number] & { group: Group }

export default function SandboxDialog({
  open,
  onOpenChange
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const [example, setExample] = useState<(typeof sandboxExamples)[number]>(sandboxExamples[0])
  const [code, setCode] = useState<string>(sandboxExamples[0].code)
  const [busy, setBusy] = useState<'probe' | 'run' | 'diagnose' | 'request' | null>(null)
  const [result, setResult] = useState('')
  const [cases, setCases] = useState<CaseResult[]>([])
  const [selectedGroup, setSelectedGroup] = useState<Group>('rpc')
  const [reports, setReports] = useState<Partial<Record<Group, string>>>({})
  const [error, setError] = useState('')
  const [activeGroup, setActiveGroup] = useState<Group | null>(null)
  const [rpcValue, setRpcValue] = useState('20')
  const [allowCallback, setAllowCallback] = useState(true)
  const [url, setUrl] = useState('https://example.com/')
  const [origins, setOrigins] = useState('https://example.com')
  const [requests, setRequests] = useState<Partial<Record<'rpc' | 'network', OutputFor<'sandbox.request'>>>>({})
  const stopped = useRef(false)

  async function sendRequest() {
    if (selectedGroup !== 'rpc' && selectedGroup !== 'network') return
    const kind = selectedGroup
    const value = rpcValue.trim() ? Number(rpcValue) : NaN
    if (kind === 'rpc' && (!Number.isFinite(value) || Math.abs(value) > 1000000)) {
      setError(t('settings.about.sandbox.interactive.invalid'))
      return
    }
    const input: InputFor<'sandbox.request'> =
      kind === 'rpc'
        ? { kind, value, allowCallback }
        : {
            kind,
            url: url.trim(),
            allowedOrigins: origins
              .split('\n')
              .map((line) => line.trim())
              .filter(Boolean)
          }
    setBusy('request')
    setActiveGroup(kind)
    setError('')
    setRequests((previous) => ({ ...previous, [kind]: undefined }))
    try {
      const output = await ipcApi.request('sandbox.request', input)
      setRequests((previous) => ({ ...previous, [kind]: output }))
    } catch (error) {
      setError(String(error))
    } finally {
      setActiveGroup(null)
      setBusy(null)
    }
  }

  async function diagnose(selected: readonly Group[]) {
    setBusy('diagnose')
    stopped.current = false
    setCases((previous) => previous.filter((item) => !selected.includes(item.group)))
    setReports((previous) =>
      Object.fromEntries(Object.entries(previous).filter(([group]) => !selected.some((item) => item === group)))
    )
    setError('')
    try {
      for (const group of selected) {
        if (stopped.current) break
        setActiveGroup(group)
        setSelectedGroup(group)
        const output = await ipcApi.request('sandbox.diagnose', { group })
        setCases((previous) => [...previous, ...output.results.map((item) => ({ ...item, group }))])
        setReports((previous) => ({ ...previous, [group]: output.report }))
      }
    } catch (error) {
      setError(String(error))
    } finally {
      setActiveGroup(null)
      setBusy(null)
    }
  }

  async function execute(action: 'probe' | 'run') {
    setBusy(action)
    setError('')
    setResult('')
    try {
      if (action === 'probe') {
        setResult((await ipcApi.request('sandbox.probe')).report)
      } else {
        const output = await ipcApi.request('sandbox.run', { code, timeoutMs: example.timeoutMs })
        setResult([output.stdout, output.stderr, output.report].filter(Boolean).join('\n'))
      }
    } catch (error) {
      setResult(String(error))
    } finally {
      setBusy(null)
    }
  }

  async function stop() {
    stopped.current = true
    try {
      await ipcApi.request('sandbox.stop')
    } catch (error) {
      setError(String(error))
    }
  }

  const interactive = selectedGroup === 'rpc' || selectedGroup === 'network'
  const request = interactive ? requests[selectedGroup] : undefined
  const visibleCases = cases.filter((item) => item.group === selectedGroup)

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && (busy === 'run' || busy === 'diagnose' || busy === 'request'))
          void stop().then(() => onOpenChange(false))
        else onOpenChange(next)
      }}>
      <DialogContent className="flex max-h-[90vh] flex-col overflow-hidden sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t('settings.about.sandbox.title')}</DialogTitle>
          <DialogDescription>{t('settings.about.sandbox.diagnostics.description')}</DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="capabilities" className="min-h-0 gap-4">
          <TabsList className="h-auto shrink-0 flex-wrap">
            <TabsTrigger value="capabilities" disabled={busy !== null}>
              {t('settings.about.sandbox.diagnostics.title')}
            </TabsTrigger>
            <TabsTrigger value="script" disabled={busy !== null}>
              {t('settings.about.sandbox.diagnostics.script')}
            </TabsTrigger>
          </TabsList>
          <TabsContent
            value="capabilities"
            className="min-h-0 data-[state=active]:flex data-[state=active]:flex-col gap-4">
            <div className="flex shrink-0 flex-wrap items-center gap-3">
              {interactive && (
                <Button disabled={busy !== null} onClick={() => void sendRequest()}>
                  {t('settings.about.sandbox.interactive.send')}
                </Button>
              )}
              <Button
                variant={interactive ? 'outline' : 'default'}
                disabled={busy !== null}
                onClick={() => void diagnose([selectedGroup])}>
                {t('settings.about.sandbox.diagnostics.run_group')}
              </Button>
              <Button variant="outline" disabled={busy !== null} onClick={() => void diagnose(groups)}>
                {t('settings.about.sandbox.diagnostics.all')}
              </Button>
              <Button
                variant="outline"
                disabled={busy !== 'diagnose' && busy !== 'request'}
                onClick={() => void stop()}>
                {t('common.stop')}
              </Button>
            </div>
            <div className="min-h-0 space-y-6 overflow-y-auto">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {groups.map((group) => {
                  const results = cases.filter((item) => item.group === group)
                  return (
                    <Button
                      key={group}
                      variant={selectedGroup === group ? 'secondary' : 'outline'}
                      className="h-auto min-w-0 flex-col items-start gap-2 p-3 text-start whitespace-normal"
                      aria-label={t(groupLabels[group])}
                      aria-pressed={selectedGroup === group}
                      onClick={() => setSelectedGroup(group)}>
                      <span className="text-sm font-medium">{t(groupLabels[group])}</span>
                      <span className="text-xs">
                        {activeGroup !== group && <>{t('settings.about.sandbox.interactive.regression')} · </>}
                        {activeGroup === group
                          ? t('settings.about.sandbox.diagnostics.running', { group: t(groupLabels[group]) })
                          : results.length
                            ? t('settings.about.sandbox.diagnostics.summary', {
                                passed: results.filter((item) => item.status === 'passed').length,
                                total: results.length
                              })
                            : t('settings.about.sandbox.diagnostics.not_run')}
                        {activeGroup !== group &&
                          [...new Set(results.map((item) => item.status))]
                            .filter((status) => status !== 'passed')
                            .map((status) => <span key={status}> · {t(statusLabels[status])}</span>)}
                      </span>
                    </Button>
                  )
                })}
              </div>
              <section aria-label={t(groupLabels[selectedGroup])} className="space-y-2">
                <h3 className="text-sm font-medium">{t(groupLabels[selectedGroup])}</h3>
                {!interactive && <p className="text-sm text-muted-foreground">{t(groupDescriptions[selectedGroup])}</p>}
                {interactive && (
                  <div className="space-y-4 pb-4">
                    <p className="text-sm text-muted-foreground">
                      {selectedGroup === 'rpc'
                        ? t('settings.about.sandbox.interactive.rpc_help')
                        : t('settings.about.sandbox.interactive.network_help')}
                    </p>
                    {selectedGroup === 'rpc' ? (
                      <>
                        <div className="space-y-2">
                          <Label htmlFor="sandbox-rpc-value">{t('settings.about.sandbox.interactive.rpc_value')}</Label>
                          <Input
                            id="sandbox-rpc-value"
                            type="number"
                            min={-1000000}
                            max={1000000}
                            value={rpcValue}
                            onChange={(event) => {
                              setRpcValue(event.target.value)
                              setRequests((previous) => ({ ...previous, rpc: undefined }))
                            }}
                            disabled={busy !== null}
                          />
                        </div>
                        <div className="flex items-center gap-2">
                          <Checkbox
                            id="sandbox-rpc-callback"
                            checked={allowCallback}
                            onCheckedChange={(checked) => {
                              setAllowCallback(checked === true)
                              setRequests((previous) => ({ ...previous, rpc: undefined }))
                            }}
                            disabled={busy !== null}
                          />
                          <Label htmlFor="sandbox-rpc-callback">
                            {t('settings.about.sandbox.interactive.allow_callback')}
                          </Label>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="space-y-2">
                          <Label htmlFor="sandbox-network-url">{t('settings.about.sandbox.interactive.url')}</Label>
                          <Input
                            id="sandbox-network-url"
                            type="url"
                            maxLength={2048}
                            value={url}
                            onChange={(event) => {
                              setUrl(event.target.value)
                              setRequests((previous) => ({ ...previous, network: undefined }))
                            }}
                            disabled={busy !== null}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="sandbox-network-origins">
                            {t('settings.about.sandbox.interactive.origins')}
                          </Label>
                          <Textarea.Input
                            id="sandbox-network-origins"
                            className="h-24 field-sizing-fixed font-mono text-xs"
                            value={origins}
                            onValueChange={(value) => {
                              setOrigins(value)
                              setRequests((previous) => ({ ...previous, network: undefined }))
                            }}
                            maxLength={131072}
                            disabled={busy !== null}
                            spellCheck={false}
                          />
                        </div>
                      </>
                    )}
                  </div>
                )}
                <div aria-live="polite" aria-busy={activeGroup === selectedGroup}>
                  {activeGroup && (
                    <p role="status" className="text-sm text-muted-foreground">
                      {t('settings.about.sandbox.diagnostics.running', { group: t(groupLabels[activeGroup]) })}
                    </p>
                  )}
                  {error && (
                    <p role="alert" className="break-words text-sm text-error">
                      {error}
                    </p>
                  )}
                  {request && (
                    <section className="space-y-3 pb-4" aria-label={t('settings.about.sandbox.interactive.trace')}>
                      <h4 className="text-sm font-medium">{t('settings.about.sandbox.interactive.trace')}</h4>
                      <ol>
                        {request.trace.map((entry, index) => (
                          <li key={index}>
                            <Accordion
                              type="single"
                              collapsible
                              defaultValue={
                                ['callback-result', 'response', 'error'].includes(entry.step) ? 'step' : undefined
                              }>
                              <AccordionItem value="step">
                                <AccordionTrigger className="gap-2 py-2 text-xs text-start">
                                  <span className={entry.step === 'error' ? 'text-error' : 'font-medium'}>
                                    {index + 1}. {t(stepLabels[entry.step])}
                                  </span>
                                  <span className="ms-auto text-muted-foreground">+{entry.elapsedMs} ms</span>
                                </AccordionTrigger>
                                <AccordionContent>
                                  <pre className="rounded-md bg-muted p-3 text-xs whitespace-pre-wrap break-words">
                                    {entry.detail}
                                  </pre>
                                </AccordionContent>
                              </AccordionItem>
                            </Accordion>
                          </li>
                        ))}
                      </ol>
                    </section>
                  )}
                  {!!visibleCases.length && (
                    <h4 className="text-sm font-medium">{t('settings.about.sandbox.interactive.regression')}</h4>
                  )}
                  {!interactive && !visibleCases.length && !activeGroup && (
                    <p className="text-sm text-muted-foreground">{t('settings.about.sandbox.diagnostics.empty')}</p>
                  )}
                  {visibleCases.map((item) => (
                    <Accordion
                      key={`${item.group}:${item.id}`}
                      type="single"
                      collapsible
                      defaultValue={item.status !== 'passed' ? 'evidence' : undefined}>
                      <AccordionItem value="evidence">
                        <AccordionTrigger className="gap-3 py-3 text-sm font-normal text-start">
                          <span className="min-w-0 flex-1">
                            {Object.hasOwn(caseLabels, item.id)
                              ? t(caseLabels[item.id as keyof typeof caseLabels])
                              : item.id === item.group
                                ? t(groupLabels[item.group])
                                : item.id === 'backend'
                                  ? t('settings.about.sandbox.probe')
                                  : item.id}
                          </span>
                          <span className={item.status === 'failed' ? 'text-error' : 'text-muted-foreground'}>
                            {t(statusLabels[item.status])}
                          </span>
                        </AccordionTrigger>
                        <AccordionContent className="text-xs">
                          <dl className="space-y-2 break-words">
                            <dt className="text-muted-foreground">
                              {t('settings.about.sandbox.diagnostics.expected')}
                            </dt>
                            <dd className="font-mono">{item.expected}</dd>
                            <dt className="text-muted-foreground">{t('settings.about.sandbox.diagnostics.actual')}</dt>
                            <dd className="whitespace-pre-wrap font-mono">{item.actual}</dd>
                          </dl>
                        </AccordionContent>
                      </AccordionItem>
                    </Accordion>
                  ))}
                </div>
              </section>
              {reports[selectedGroup] && (
                <Accordion type="single" collapsible>
                  <AccordionItem value="report">
                    <AccordionTrigger className="text-xs text-muted-foreground">
                      {t('settings.about.sandbox.result')}
                    </AccordionTrigger>
                    <AccordionContent>
                      <pre className="whitespace-pre-wrap break-words font-mono text-xs">{reports[selectedGroup]}</pre>
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>
              )}
            </div>
          </TabsContent>
          <TabsContent value="script" className="min-h-0 data-[state=active]:flex data-[state=active]:flex-col gap-4">
            <div className="flex shrink-0 flex-wrap gap-3">
              <Button disabled={busy !== null || !code.trim()} onClick={() => void execute('run')}>
                {t('settings.about.sandbox.run')}
              </Button>
              <Button variant="outline" disabled={busy !== null} onClick={() => void execute('probe')}>
                {t('settings.about.sandbox.probe')}
              </Button>
              <Button variant="outline" disabled={busy !== 'run'} onClick={() => void stop()}>
                {t('common.stop')}
              </Button>
            </div>
            <div className="min-h-0 space-y-4 overflow-y-auto">
              <p className="text-sm text-muted-foreground">{t('settings.about.sandbox.description')}</p>
              {error && (
                <p role="alert" className="break-words text-sm text-error">
                  {error}
                </p>
              )}
              <div className="space-y-2">
                <Label htmlFor="sandbox-example">{t('settings.about.sandbox.examples.label')}</Label>
                <Select
                  value={example.id}
                  disabled={busy !== null}
                  onValueChange={(id) => {
                    const next = sandboxExamples.find((item) => item.id === id)
                    if (!next) return
                    setExample(next)
                    setCode(next.code)
                    setResult('')
                  }}>
                  <SelectTrigger id="sandbox-example" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {sandboxExamples.map((item) => (
                      <SelectItem key={item.id} value={item.id}>
                        {t(item.labelKey)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {t('settings.about.sandbox.examples.duration', { seconds: example.timeoutMs / 1000 })}
                </p>
                {code === example.code && (
                  <div className="space-y-1 text-xs text-muted-foreground">
                    <p>{t('settings.about.sandbox.examples.expected')}</p>
                    <p className="break-words font-mono">{example.expected}</p>
                  </div>
                )}
              </div>
              <Label htmlFor="sandbox-code">{t('settings.about.sandbox.code')}</Label>
              <Textarea.Input
                id="sandbox-code"
                className="h-32 min-h-24 field-sizing-fixed font-mono"
                value={code}
                onValueChange={setCode}
                maxLength={32768}
                disabled={busy !== null}
                spellCheck={false}
              />
              <Label htmlFor="sandbox-result">{t('settings.about.sandbox.result')}</Label>
              <Textarea.Input
                id="sandbox-result"
                className="h-40 min-h-24 field-sizing-fixed font-mono text-xs"
                value={result}
                readOnly
                aria-live="polite"
                aria-busy={busy !== null}
              />
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
