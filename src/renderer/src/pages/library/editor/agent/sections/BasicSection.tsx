import {
  Button,
  EmojiAvatar,
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldLabel,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Separator,
  Switch,
  Textarea
} from '@cherrystudio/ui'
import { loggerService } from '@logger'
import EmojiPicker from '@renderer/components/EmojiPicker'
import SelectAgentBaseModelButton from '@renderer/pages/agents/components/SelectAgentBaseModelButton'
import type { AgentBaseWithId, ApiModel } from '@renderer/types'
import { Plus, Trash2 } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { AgentFormState } from '../descriptor'

const logger = loggerService.withContext('AgentConfig:BasicSection')

interface Props {
  form: AgentFormState
  onChange: (patch: Partial<AgentFormState>) => void
  nameError?: string
  modelError?: string
}

// Avatar quick-pick presets shown next to the emoji picker button.
const AVATAR_PRESETS = ['🤖', '🧠', '⚡', '🚀', '🛠️', '🎯', '📊', '🔬'] as const

/**
 * Mirrors the legacy AgentSettings **Essential** tab: the section where
 * everything identity- and runtime-related lives. Fields (in original
 * popup order):
 *
 * - name
 * - model (primary + plan + small — all from `AgentBase`)
 * - accessible_paths
 * - configuration.soul_enabled
 * - configuration.heartbeat_enabled / heartbeat_interval
 * - description
 * - configuration.avatar (new here — old popup surfaced it via NameSetting)
 *
 * Each sub-field stays in one flat list to match the "one tall Essential
 * tab" feel of the legacy popup.
 */
const BasicSection: FC<Props> = ({ form, onChange, nameError, modelError }) => {
  const { t } = useTranslation()
  const [emojiOpen, setEmojiOpen] = useState(false)

  // Synthetic agent-base shapes per model field — `SelectAgentBaseModelButton`
  // expects an `AgentBaseWithId` and passes `agent.type` to the model-filter
  // resolver. We construct one per field (main / plan / small) so the picker
  // highlights the currently-bound model and filters to the agent type.
  const mainAgentBase = useMemo<AgentBaseWithId>(
    () => buildAgentBaseShape({ id: 'draft-main', model: form.model, accessiblePaths: form.accessiblePaths }),
    [form.model, form.accessiblePaths]
  )
  const planAgentBase = useMemo<AgentBaseWithId>(
    () => buildAgentBaseShape({ id: 'draft-plan', model: form.planModel, accessiblePaths: form.accessiblePaths }),
    [form.planModel, form.accessiblePaths]
  )
  const smallAgentBase = useMemo<AgentBaseWithId>(
    () => buildAgentBaseShape({ id: 'draft-small', model: form.smallModel, accessiblePaths: form.accessiblePaths }),
    [form.smallModel, form.accessiblePaths]
  )

  const removePath = (path: string) => {
    onChange({ accessiblePaths: form.accessiblePaths.filter((p) => p !== path) })
  }
  // Legacy `AccessibleDirsSetting` parity: use the IPC folder selector, dedupe
  // against the current list, and toast on both duplicate + select failure.
  const addPath = useCallback(async () => {
    try {
      const selected = await window.api.file.selectFolder()
      if (!selected) return
      if (form.accessiblePaths.includes(selected)) {
        window.toast.warning(t('agent.session.accessible_paths.duplicate'))
        return
      }
      onChange({ accessiblePaths: [...form.accessiblePaths, selected] })
    } catch (error) {
      logger.error('Failed to select accessible path:', error as Error)
      window.toast.error(t('agent.session.accessible_paths.select_failed'))
    }
  }, [form.accessiblePaths, onChange, t])

  return (
    <div className="flex max-w-lg flex-col gap-5">
      <div>
        <h3 className="mb-1 text-[14px] text-foreground">{t('library.config.agent.section.basic.title')}</h3>
        <p className="text-[10px] text-muted-foreground/55">{t('library.config.agent.section.basic.desc')}</p>
      </div>

      <Field className="gap-1.5">
        <FieldLabel className="font-normal text-[10px] text-muted-foreground/60">{t('common.avatar')}</FieldLabel>
        <FieldContent>
          <div className="flex items-center gap-2">
            <Popover open={emojiOpen} onOpenChange={setEmojiOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  aria-label={t('library.config.basic.pick_avatar')}
                  className="rounded-[20%] outline-none transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring/50">
                  <EmojiAvatar size={48} fontSize={24}>
                    {form.avatar || '🤖'}
                  </EmojiAvatar>
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0">
                <EmojiPicker
                  onEmojiClick={(emoji) => {
                    onChange({ avatar: emoji })
                    setEmojiOpen(false)
                  }}
                />
              </PopoverContent>
            </Popover>
            <div className="flex flex-wrap gap-1">
              {AVATAR_PRESETS.map((a) => {
                const active = form.avatar === a
                return (
                  <Button
                    key={a}
                    type="button"
                    variant="ghost"
                    onClick={() => onChange({ avatar: a })}
                    className={`flex size-7 min-h-0 items-center justify-center rounded-lg font-normal text-sm shadow-none transition-all focus-visible:ring-0 ${
                      active ? 'bg-accent ring-1 ring-primary/20' : 'hover:bg-accent/40'
                    }`}>
                    {a}
                  </Button>
                )
              })}
            </div>
          </div>
        </FieldContent>
      </Field>

      <Field data-invalid={Boolean(nameError) || undefined} className="gap-1.5">
        <FieldLabel className="font-normal text-[10px] text-muted-foreground/60">
          {t('library.config.agent.field.name.label')}
        </FieldLabel>
        <FieldContent>
          <Input
            value={form.name}
            onChange={(e) => onChange({ name: e.target.value })}
            placeholder={t('library.config.agent.field.name.placeholder')}
            aria-invalid={Boolean(nameError) || undefined}
            className="rounded-xl border-border/20 bg-accent/10 text-[11px] focus:border-border/40 focus:bg-accent/15 aria-invalid:border-destructive/50"
          />
          <FieldError className="text-[9px]" errors={nameError ? [{ message: nameError }] : undefined} />
        </FieldContent>
      </Field>

      <ModelSubsection>
        <ModelField
          label={t('library.config.agent.field.model.label')}
          hint={t('library.config.agent.field.model.hint')}
          agentBase={mainAgentBase}
          errorMessage={modelError}
          onSelect={(model) => onChange({ model: model.id })}
        />
        <ModelField
          label={t('library.config.agent.field.plan_model.label')}
          hint={t('library.config.agent.field.plan_model.hint')}
          agentBase={planAgentBase}
          onSelect={(model) => onChange({ planModel: model.id })}
        />
        <ModelField
          label={t('library.config.agent.field.small_model.label')}
          hint={t('library.config.agent.field.small_model.hint')}
          agentBase={smallAgentBase}
          onSelect={(model) => onChange({ smallModel: model.id })}
        />
      </ModelSubsection>

      <Field className="gap-1.5">
        <FieldLabel className="font-normal text-[10px] text-muted-foreground/60">
          {t('library.config.agent.field.accessible_paths.label')}
        </FieldLabel>
        <FieldContent>
          <div className="flex flex-col gap-1.5">
            {form.accessiblePaths.length === 0 ? (
              <FieldDescription className="text-[10px] text-muted-foreground/40">
                {t('library.config.agent.field.accessible_paths.empty')}
              </FieldDescription>
            ) : null}
            {form.accessiblePaths.map((p) => (
              <div key={p} className="flex items-center gap-2 rounded-xl border border-border/15 bg-accent/5 px-3 py-2">
                <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground/80" title={p}>
                  {p}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => removePath(p)}
                  className="shrink-0 text-muted-foreground/60 hover:text-destructive">
                  <Trash2 size={12} />
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="ghost"
              onClick={() => void addPath()}
              className="mt-1 h-auto min-h-0 w-fit rounded-lg border border-border/20 border-dashed px-2.5 py-1 font-normal text-[10px] text-muted-foreground/60 shadow-none transition hover:bg-accent/15 hover:text-foreground focus-visible:ring-0">
              <Plus size={10} className="mr-1" />
              {t('library.config.agent.field.accessible_paths.add')}
            </Button>
          </div>
        </FieldContent>
      </Field>

      <SwitchRow
        label={t('library.config.agent.field.soul_enabled.label')}
        help={t('library.config.agent.field.soul_enabled.help')}
        checked={form.soulEnabled}
        onCheckedChange={(checked) => onChange({ soulEnabled: checked })}
      />

      <SwitchRow
        label={t('library.config.agent.field.heartbeat_enabled.label')}
        checked={form.heartbeatEnabled}
        onCheckedChange={(checked) => onChange({ heartbeatEnabled: checked })}
      />

      {form.heartbeatEnabled ? (
        <Field className="gap-1.5">
          <FieldLabel className="font-normal text-[10px] text-muted-foreground/60">
            {t('library.config.agent.field.heartbeat_interval.label')}
          </FieldLabel>
          <FieldContent>
            <Input
              type="number"
              min={1}
              max={1440}
              value={form.heartbeatInterval || ''}
              onChange={(e) => onChange({ heartbeatInterval: Number(e.target.value) || 0 })}
              className="rounded-xl border-border/20 bg-accent/10 text-[11px] focus:border-border/40 focus:bg-accent/15"
            />
          </FieldContent>
        </Field>
      ) : null}

      <Field className="gap-1.5">
        <FieldLabel className="font-normal text-[10px] text-muted-foreground/60">
          {t('library.config.agent.field.description.label')}
        </FieldLabel>
        <FieldContent>
          <Textarea.Input
            value={form.description}
            onChange={(e) => onChange({ description: e.target.value })}
            placeholder={t('library.config.agent.field.description.placeholder')}
            className="min-h-18 rounded-xl border-border/20 bg-accent/10 px-3 py-2 text-[11px] focus:border-border/40 focus:bg-accent/15"
          />
        </FieldContent>
      </Field>
    </div>
  )
}

function ModelSubsection({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-muted-foreground/60">{t('library.config.agent.model_config')}</span>
        <Separator className="flex-1 bg-border/10" />
      </div>
      {children}
    </div>
  )
}

function ModelField({
  label,
  hint,
  agentBase,
  errorMessage,
  onSelect
}: {
  label: string
  hint: string
  agentBase: AgentBaseWithId
  errorMessage?: string
  onSelect: (model: ApiModel) => void
}) {
  const invalid = Boolean(errorMessage)
  return (
    <Field data-invalid={invalid || undefined} className="gap-1.5">
      <div className="flex items-center justify-between gap-3">
        <FieldLabel className="font-normal text-[10px] text-muted-foreground/60">{label}</FieldLabel>
        <span className="text-[9px] text-muted-foreground/35">{hint}</span>
      </div>
      <FieldContent>
        <div
          className={`rounded-xl border bg-accent/10 transition-colors ${
            invalid ? 'border-destructive/50' : 'border-border/20'
          }`}>
          <SelectAgentBaseModelButton
            agentBase={agentBase}
            onSelect={async (model) => {
              onSelect(model)
            }}
            className="w-full"
            containerClassName="flex w-full items-center justify-between gap-1.5 px-2"
            buttonSize="middle"
            buttonStyle={{ borderRadius: 12, padding: '4px 8px', width: '100%' }}
          />
        </div>
        <FieldError className="text-[9px]" errors={errorMessage ? [{ message: errorMessage }] : undefined} />
      </FieldContent>
    </Field>
  )
}

/**
 * Temporary shape bridge: feed `SelectAgentBaseModelButton` an `AgentEntity`-
 * shaped object so its internal `isAgentEntity` check passes and the picker
 * applies the correct model filter (`getModelFilterByAgentType('claude-code')`).
 * Draft sentinel id during create mode — real id once the agent is saved.
 */
function buildAgentBaseShape({
  id,
  model,
  accessiblePaths
}: {
  id: string
  model: string
  accessiblePaths: string[]
}): AgentBaseWithId {
  return {
    id,
    type: 'claude-code',
    model,
    accessiblePaths,
    mcps: [],
    allowedTools: [],
    configuration: {},
    createdAt: '1970-01-01T00:00:00.000Z',
    updatedAt: '1970-01-01T00:00:00.000Z'
  } as unknown as AgentBaseWithId
}

function SwitchRow({
  label,
  help,
  checked,
  onCheckedChange
}: {
  label: string
  help?: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-xl border border-border/15 bg-accent/5 px-3 py-2.5">
      <div className="flex flex-col gap-0.5">
        <span className="text-[11px] text-foreground">{label}</span>
        {help ? <span className="text-[9px] text-muted-foreground/40">{help}</span> : null}
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  )
}

export default BasicSection
