import { Plus, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import {
  Button,
  Input,
  InputNumber,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Textarea
} from '@cherrystudio/ui'
import { AGENT_HOOK_EVENT_LABEL_KEYS } from '@renderer/utils/agent/agentHookLabels'
import { AgentHookEventSchema, type AgentHook } from '@shared/ai/agentHook'

export function AgentHooksField({
  value,
  onChange,
  portalContainer
}: {
  value: AgentHook[]
  onChange: (hooks: AgentHook[]) => void
  portalContainer: HTMLElement | null
}) {
  const { t } = useTranslation()
  const update = (id: string, patch: Partial<AgentHook>) => {
    onChange(value.map((hook) => (hook.id === id ? { ...hook, ...patch } : hook)))
  }
  const add = () =>
    onChange([
      ...value,
      {
        id: crypto.randomUUID(),
        name: '',
        event: 'preToolUse',
        enabled: false,
        command: '',
        timeoutMs: 10_000
      }
    ])

  return (
    <div className="space-y-4">
      <p className="text-muted-foreground text-sm">{t('agent_hooks.description')}</p>
      {value.length === 0 ? (
        <p className="py-4 text-center text-muted-foreground text-sm">{t('agent_hooks.empty')}</p>
      ) : null}
      {value.map((hook) => (
        <section
          key={hook.id}
          aria-label={hook.name || t('agent_hooks.title')}
          className="space-y-3 rounded-lg border border-border-subtle p-4">
          <div className="flex items-center gap-3">
            <Input
              className="min-w-0 flex-1"
              aria-label={t('agent_hooks.name')}
              placeholder={t('agent_hooks.name')}
              maxLength={100}
              value={hook.name}
              onChange={(event) => update(hook.id, { name: event.target.value })}
            />
            <Switch
              size="sm"
              checked={hook.enabled}
              disabled={!hook.command.trim()}
              aria-label={t('agent_hooks.enabled')}
              onCheckedChange={(enabled) => update(hook.id, { enabled })}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={t('agent_hooks.remove')}
              onClick={() => onChange(value.filter((item) => item.id !== hook.id))}>
              <Trash2 className="size-4" />
            </Button>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor={`${hook.id}-event`}>{t('agent_hooks.event')}</Label>
              <Select
                value={hook.event}
                onValueChange={(event) =>
                  update(hook.id, { event: AgentHookEventSchema.parse(event), enabled: false })
                }>
                <SelectTrigger id={`${hook.id}-event`} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent portalContainer={portalContainer}>
                  {AgentHookEventSchema.options.map((event) => (
                    <SelectItem key={event} value={event}>
                      {t(AGENT_HOOK_EVENT_LABEL_KEYS[event])}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${hook.id}-timeout`}>{t('agent_hooks.timeout')}</Label>
              <InputNumber
                id={`${hook.id}-timeout`}
                className="w-full"
                min={1}
                max={60}
                step={1}
                value={hook.timeoutMs / 1000}
                onBlur={(seconds) => {
                  if (seconds !== null && seconds * 1000 !== hook.timeoutMs)
                    update(hook.id, { timeoutMs: seconds * 1000, enabled: false })
                }}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${hook.id}-tool-match`}>{t('agent_hooks.matcher.tool_name')}</Label>
            <Input
              id={`${hook.id}-tool-match`}
              value={hook.matcher?.toolNameContains ?? ''}
              maxLength={256}
              onChange={(event) =>
                update(hook.id, {
                  matcher: { ...hook.matcher, toolNameContains: event.target.value },
                  enabled: false
                })
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${hook.id}-input-match`}>{t('agent_hooks.matcher.input')}</Label>
            <Input
              id={`${hook.id}-input-match`}
              value={hook.matcher?.inputContains ?? ''}
              maxLength={1000}
              onChange={(event) =>
                update(hook.id, {
                  matcher: { ...hook.matcher, inputContains: event.target.value },
                  enabled: false
                })
              }
            />
            <p className="text-muted-foreground text-xs">{t('agent_hooks.matcher.help')}</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${hook.id}-command`}>{t('agent_hooks.command')}</Label>
            <Textarea.Input
              id={`${hook.id}-command`}
              className="min-h-24 font-mono text-xs"
              spellCheck={false}
              maxLength={16_384}
              value={hook.command}
              onChange={(event) => update(hook.id, { command: event.target.value, enabled: false })}
            />
          </div>
        </section>
      ))}
      <Button type="button" variant="outline" disabled={value.length >= 16} onClick={add}>
        <Plus className="size-4" />
        {t('agent_hooks.add')}
      </Button>
    </div>
  )
}
