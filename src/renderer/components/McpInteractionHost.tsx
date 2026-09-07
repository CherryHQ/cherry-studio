import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Textarea
} from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { ipcApi, useIpcOn } from '@renderer/ipc'
import type { EventPayload } from '@shared/ipc/types'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('McpInteractionHost')
type Interaction = EventPayload<'mcp.interaction.requested'>

function elicitationParams(interaction: Interaction): {
  mode?: unknown
  message?: unknown
  url?: unknown
  requestedSchema?: unknown
} {
  if (typeof interaction.payload !== 'object' || interaction.payload === null) return {}
  const payload = interaction.payload as { params?: unknown }
  return typeof payload.params === 'object' && payload.params !== null ? payload.params : {}
}

function initialFormValue(interaction: Interaction): string {
  if (interaction.kind !== 'elicitation') return ''
  const schema = elicitationParams(interaction).requestedSchema
  if (typeof schema !== 'object' || schema === null) return '{}'
  const properties = (schema as { properties?: unknown }).properties
  if (typeof properties !== 'object' || properties === null) return '{}'

  const value = Object.fromEntries(
    Object.entries(properties).map(([name, definition]) => {
      const type =
        typeof definition === 'object' && definition !== null ? (definition as { type?: unknown }).type : undefined
      if (type === 'boolean') return [name, false]
      if (type === 'number' || type === 'integer') return [name, 0]
      if (type === 'array') return [name, []]
      return [name, '']
    })
  )
  return JSON.stringify(value, null, 2)
}

function validateFormValue(interaction: Interaction, text: string): Record<string, unknown> {
  const value = JSON.parse(text) as unknown
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Expected a JSON object')
  }

  const schema = elicitationParams(interaction).requestedSchema as
    | { properties?: Record<string, { type?: string }>; required?: string[] }
    | undefined
  for (const name of schema?.required ?? []) {
    if (!(name in value)) throw new Error(`Missing required field: ${name}`)
  }
  for (const [name, fieldValue] of Object.entries(value)) {
    const expected = schema?.properties?.[name]?.type
    if (expected === 'array' && !Array.isArray(fieldValue)) throw new Error(`${name} must be an array`)
    if (expected === 'integer' && (!Number.isInteger(fieldValue) || typeof fieldValue !== 'number')) {
      throw new Error(`${name} must be an integer`)
    }
    if (expected && expected !== 'array' && expected !== 'integer' && typeof fieldValue !== expected) {
      throw new Error(`${name} must be a ${expected}`)
    }
  }
  return value as Record<string, unknown>
}

export function McpInteractionHost(): React.ReactElement | null {
  const { t } = useTranslation()
  const [queue, setQueue] = useState<Interaction[]>([])
  const current = queue[0]
  const [formValue, setFormValue] = useState('')
  const [validationError, setValidationError] = useState<string>()

  useIpcOn('mcp.interaction.requested', (interaction) => {
    setQueue((items) => [...items, interaction])
  })

  useEffect(() => {
    setFormValue(current ? initialFormValue(current) : '')
    setValidationError(undefined)
  }, [current])

  const params = useMemo(() => (current ? elicitationParams(current) : {}), [current])
  if (!current) return null

  const finish = async (decision: 'accept' | 'decline' | 'cancel') => {
    let value: Record<string, unknown> | undefined
    if (decision === 'accept' && current.kind === 'elicitation' && params.mode !== 'url') {
      try {
        value = validateFormValue(current, formValue || '{}')
      } catch (error) {
        setValidationError(error instanceof Error ? error.message : String(error))
        return
      }
    }

    try {
      setValidationError(undefined)
      await ipcApi.request('mcp.interaction.respond', {
        requestId: current.requestId,
        decision,
        value
      })
      setQueue((items) => {
        const remaining = items.slice(1)
        setFormValue(remaining[0] ? initialFormValue(remaining[0]) : '')
        return remaining
      })
    } catch (error) {
      logger.error('Failed to respond to MCP interaction', error as Error)
    }
  }

  const title =
    current.kind === 'elicitation'
      ? t('settings.mcp.interaction.elicitation.title')
      : current.kind === 'sampling'
        ? t('settings.mcp.interaction.sampling.title')
        : t('settings.mcp.interaction.roots.title')
  const description =
    current.kind === 'elicitation' && typeof params.message === 'string'
      ? params.message
      : current.kind === 'elicitation'
        ? t('settings.mcp.interaction.elicitation.description')
        : current.kind === 'sampling'
          ? t('settings.mcp.interaction.sampling.description')
          : t('settings.mcp.interaction.roots.description')

  return (
    <Dialog open onOpenChange={(open) => !open && void finish('cancel')}>
      <DialogContent showCloseButton={false} className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {current.kind === 'elicitation' && params.mode !== 'url' ? (
          <div className="space-y-2">
            <Textarea.Input
              value={formValue}
              onValueChange={setFormValue}
              hasError={Boolean(validationError)}
              className="min-h-40 font-mono text-xs"
            />
            {validationError && <p className="text-destructive text-xs">{validationError}</p>}
          </div>
        ) : (
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md border bg-muted/40 p-3 text-xs">
            {current.kind === 'elicitation' && typeof params.url === 'string'
              ? params.url
              : JSON.stringify(current.payload, null, 2)}
          </pre>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => void finish('decline')}>
            {t('common.decline')}
          </Button>
          <Button onClick={() => void finish('accept')}>{t('common.confirm')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
