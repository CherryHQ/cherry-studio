import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { ipcApi, useIpcOn } from '@renderer/ipc'
import type { EventPayload } from '@shared/ipc/types'

const logger = loggerService.withContext('McpInteractionHost')
type Interaction = EventPayload<'mcp.interaction.requested'>
type FormField = {
  type?: string
  title?: string
  description?: string
  default?: unknown
  enum?: string[]
  enumNames?: string[]
  oneOf?: { const: string; title?: string }[]
  anyOf?: { const: string; title?: string }[]
  items?: FormField
  minimum?: number
  maximum?: number
  minLength?: number
  maxLength?: number
  format?: string
}
type ElicitationParams = {
  mode?: string
  message?: string
  url?: string
  requestedSchema?: { type: 'object'; properties: Record<string, FormField>; required?: string[] }
}

function choices(field: FormField) {
  return (
    field.oneOf ?? field.anyOf ?? field.enum?.map((value, index) => ({ const: value, title: field.enumNames?.[index] }))
  )
}

function McpInteractionDialog({ current, remove }: { current: Interaction; remove: (id: string) => void }) {
  const { t } = useTranslation()
  const params = (current.payload as { params?: ElicitationParams })?.params ?? {}
  const schema = params.requestedSchema
  const [values, setValues] = useState<Record<string, unknown>>(() =>
    Object.fromEntries(
      Object.entries(schema?.properties ?? {})
        .filter(([, field]) => field.default !== undefined)
        .map(([name, field]) => [name, field.default])
    )
  )
  const [validationError, setValidationError] = useState<string>()
  const [submitting, setSubmitting] = useState(false)
  const busy = useRef(false)
  const form = useRef<HTMLFormElement>(null)
  const active = useRef(true)
  useEffect(() => {
    active.current = true
    return () => {
      active.current = false
    }
  }, [])
  let url: URL | undefined
  try {
    if (params.url) {
      const parsed = new URL(params.url)
      if (['https:', 'http:'].includes(parsed.protocol) && !parsed.username && !parsed.password) url = parsed
    }
  } catch {
    /* Invalid server URLs cannot be opened. */
  }

  useIpcOn('mcp.interaction.ended', ({ requestId }) => {
    if (requestId === current.requestId) active.current = false
  })

  const setValue = (name: string, value: unknown) =>
    setValues((previous) => {
      const next = { ...previous }
      if (value === undefined) delete next[name]
      else next[name] = value
      return next
    })

  const finish = async (decision: 'accept' | 'decline' | 'cancel') => {
    if (busy.current || !active.current) return
    if (decision === 'accept' && !form.current?.reportValidity()) return
    busy.current = true
    setSubmitting(true)
    try {
      if (decision === 'accept' && current.kind === 'elicitation' && params.mode !== 'url' && schema) {
        const { CfWorkerJsonSchemaValidator } = await import('@modelcontextprotocol/client/validators/cf-worker')
        const result = new CfWorkerJsonSchemaValidator().getValidator(schema)(values)
        if (!result.valid) throw new Error(result.errorMessage)
      }
      if (!active.current) return
      await ipcApi.request('mcp.interaction.respond', { requestId: current.requestId, decision, value: values })
      remove(current.requestId)
    } catch (error) {
      logger.error('Failed to respond to MCP interaction', error as Error)
      if (active.current) setValidationError(error instanceof Error ? error.message : String(error))
    } finally {
      busy.current = false
      if (active.current) setSubmitting(false)
    }
  }

  const title =
    current.kind === 'elicitation'
      ? t('settings.mcp.interaction.elicitation.title')
      : current.kind === 'sampling'
        ? t('settings.mcp.interaction.sampling.title')
        : t('settings.mcp.interaction.roots.title')
  const description =
    current.kind === 'elicitation'
      ? (params.message ?? t('settings.mcp.interaction.elicitation.description'))
      : current.kind === 'sampling'
        ? t('settings.mcp.interaction.sampling.description')
        : t('settings.mcp.interaction.roots.description')

  return (
    <Dialog open onOpenChange={(open) => !open && void finish('cancel')}>
      <DialogContent showCloseButton={false} className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
          <p className="break-all text-sm font-medium">{current.serverName}</p>
          <p className="break-all text-xs text-muted-foreground">
            {current.topicId} · {current.sourceRequestId ?? current.requestId}
          </p>
        </DialogHeader>
        <form
          ref={form}
          onSubmit={(event) => {
            event.preventDefault()
            void finish('accept')
          }}
          className="max-h-96 space-y-4 overflow-auto">
          {current.kind === 'elicitation' && params.mode !== 'url' ? (
            Object.entries(schema?.properties ?? {}).map(([name, field]) => {
              const id = `${current.requestId}-${name}`
              const options = choices(field)
              const multiOptions = field.items && choices(field.items)
              const required = schema?.required?.includes(name)
              return (
                <div key={name} className="space-y-2">
                  <Label htmlFor={id}>
                    {field.title ?? name}
                    {required ? ' *' : ''}
                  </Label>
                  {field.description && <p className="text-sm text-muted-foreground">{field.description}</p>}
                  {field.type === 'boolean' ? (
                    <Checkbox
                      id={id}
                      checked={values[name] === undefined ? 'indeterminate' : values[name] === true}
                      onCheckedChange={(value) => setValue(name, value === true)}
                    />
                  ) : options ? (
                    <Select
                      value={
                        values[name] === undefined
                          ? ''
                          : String(options.findIndex((option) => option.const === values[name]))
                      }
                      onValueChange={(value) => setValue(name, options[Number(value)]?.const)}>
                      <SelectTrigger id={id}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {options.map((option, index) => (
                          <SelectItem key={option.const} value={String(index)}>
                            {option.title ?? option.const}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : field.type === 'array' && multiOptions ? (
                    <div className="space-y-2">
                      {multiOptions.map((option) => {
                        const selected = Array.isArray(values[name]) ? (values[name] as string[]) : []
                        return (
                          <Label key={option.const} className="flex items-center gap-2">
                            <Checkbox
                              checked={selected.includes(option.const)}
                              onCheckedChange={(checked) =>
                                setValue(
                                  name,
                                  checked
                                    ? [...selected, option.const]
                                    : selected.filter((item) => item !== option.const)
                                )
                              }
                            />
                            {option.title ?? option.const}
                          </Label>
                        )
                      })}
                    </div>
                  ) : (
                    <Input
                      id={id}
                      required={required}
                      value={values[name] === undefined ? '' : String(values[name])}
                      type={
                        field.type === 'number' || field.type === 'integer'
                          ? 'number'
                          : field.format === 'email'
                            ? 'email'
                            : 'text'
                      }
                      min={field.minimum}
                      max={field.maximum}
                      step={field.type === 'integer' ? 1 : 'any'}
                      minLength={field.minLength}
                      maxLength={field.maxLength}
                      onChange={(event) =>
                        setValue(
                          name,
                          field.type === 'number' || field.type === 'integer'
                            ? event.target.value === ''
                              ? undefined
                              : event.target.valueAsNumber
                            : event.target.value
                        )
                      }
                    />
                  )}
                  {!required && values[name] !== undefined && (
                    <Button type="button" variant="ghost" size="sm" onClick={() => setValue(name, undefined)}>
                      {t('common.clear')}
                    </Button>
                  )}
                </div>
              )
            })
          ) : (
            <div className="space-y-2">
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-md border bg-muted p-3 text-xs">
                {current.kind === 'elicitation' ? params.url : JSON.stringify(current.payload, null, 2)}
              </pre>
              {current.kind === 'elicitation' && (
                <>
                  <p className="break-all font-medium">{url?.host}</p>
                  <p className="text-sm text-muted-foreground">{t('settings.mcp.interaction.url.instructions')}</p>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={!url || submitting}
                    onClick={() =>
                      url &&
                      void ipcApi
                        .request('system.shell.open_external_website', url.href)
                        .catch((error) => setValidationError(String(error)))
                    }>
                    {t('common.open')}
                  </Button>
                </>
              )}
            </div>
          )}
          {validationError && (
            <p role="alert" className="text-destructive text-xs">
              {validationError}
            </p>
          )}
        </form>
        <DialogFooter>
          <Button variant="outline" disabled={submitting} onClick={() => void finish('decline')}>
            {t('common.decline')}
          </Button>
          <Button disabled={submitting || (params.mode === 'url' && !url)} onClick={() => void finish('accept')}>
            {t('common.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function McpInteractionHost(): React.ReactElement | null {
  const [queue, setQueue] = useState<Interaction[]>([])
  const remove = (id: string) => setQueue((items) => items.filter((item) => item.requestId !== id))
  useIpcOn('mcp.interaction.requested', (interaction) =>
    setQueue((items) =>
      items.some((item) => item.requestId === interaction.requestId) ? items : [...items, interaction]
    )
  )
  useIpcOn('mcp.interaction.ended', ({ requestId }) => remove(requestId))
  return queue[0] ? <McpInteractionDialog key={queue[0].requestId} current={queue[0]} remove={remove} /> : null
}
