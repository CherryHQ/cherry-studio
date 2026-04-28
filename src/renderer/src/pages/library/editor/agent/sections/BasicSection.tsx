import {
  Badge,
  Button,
  Combobox,
  type ComboboxOption,
  DescriptionSwitch,
  EditableNumber,
  EmojiAvatar,
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldLabel,
  FieldSeparator,
  FieldSet,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Textarea,
  Tooltip
} from '@cherrystudio/ui'
import { loggerService } from '@logger'
import EmojiPicker from '@renderer/components/EmojiPicker'
import { ModelSelector } from '@renderer/components/ModelSelector'
import { useModels } from '@renderer/hooks/useModels'
import {
  ENDPOINT_TYPE,
  isUniqueModelId,
  type Model,
  MODEL_CAPABILITY,
  type UniqueModelId
} from '@shared/data/types/model'
import { Check, ChevronsUpDown, Plus, Trash2, X } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { DEFAULT_TAG_COLOR } from '../../../constants'
import type { AgentFormState } from '../descriptor'

const logger = loggerService.withContext('AgentConfig:BasicSection')

interface Props {
  form: AgentFormState
  onChange: (patch: Partial<AgentFormState>) => void
  nameError?: string
  modelError?: string
  /**
   * Map of tag name → backend-assigned color (random hex chosen at POST time).
   * Used for the tag-dot icon in the Combobox options.
   */
  tagColorByName: Map<string, string>
  /**
   * Full set of tags available in the backend. Feeds the tag-select options.
   * New tags must be created from the library page's "+ 标签" entry point —
   * this section is selection-only.
   */
  allTagNames: string[]
}

// Avatar quick-pick presets shown next to the emoji picker button.
const AVATAR_PRESETS = ['🤖', '🧠', '⚡', '🚀', '🛠️', '🎯', '📊', '🔬'] as const
const DISALLOWED_AGENT_CAPABILITIES = new Set<string>([
  MODEL_CAPABILITY.EMBEDDING,
  MODEL_CAPABILITY.RERANK,
  MODEL_CAPABILITY.IMAGE_GENERATION
])

function buildModelsById(models: Model[]): Map<UniqueModelId, Model> {
  return new Map(models.map((model) => [model.id, model]))
}

function isSelectableAgentModel(model: Model): boolean {
  return (
    model.endpointTypes?.includes(ENDPOINT_TYPE.ANTHROPIC_MESSAGES) === true &&
    !model.capabilities.some((capability) => DISALLOWED_AGENT_CAPABILITIES.has(capability))
  )
}

function toSelectorValue(value: string): UniqueModelId | undefined {
  return isUniqueModelId(value) ? value : undefined
}

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
const BasicSection: FC<Props> = ({ form, onChange, nameError, modelError, tagColorByName, allTagNames }) => {
  const { t } = useTranslation()
  const [emojiOpen, setEmojiOpen] = useState(false)
  const tagColor = useCallback(
    (name: string): string => tagColorByName.get(name) ?? DEFAULT_TAG_COLOR,
    [tagColorByName]
  )
  const { models } = useModels({ enabled: true })
  const modelsById = useMemo(() => buildModelsById(models), [models])

  // Tag options for the select. `form.tags` may include names the backend list
  // doesn't know yet (e.g. typed in the card menu before /tags refreshed) —
  // union them so they stay visible as currently-selected.
  const tagOptions = useMemo<ComboboxOption[]>(() => {
    const names = Array.from(new Set([...allTagNames, ...form.tags]))
    names.sort((a, b) => a.localeCompare(b, 'zh'))
    return names.map((name) => ({
      value: name,
      label: name,
      icon: (
        <span
          className="inline-block size-2 shrink-0 rounded-full"
          style={{ backgroundColor: tagColor(name) }}
          aria-hidden="true"
        />
      )
    }))
  }, [allTagNames, form.tags, tagColor])

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
        <h3 className="mb-1 text-base text-foreground">{t('library.config.agent.section.basic.title')}</h3>
        <p className="text-xs text-muted-foreground/60">{t('library.config.agent.section.basic.desc')}</p>
      </div>

      <Field className="gap-1.5">
        <FieldLabel className="font-normal text-sm text-muted-foreground/80">{t('common.avatar')}</FieldLabel>
        <FieldContent>
          <div className="flex items-center gap-2">
            <Popover open={emojiOpen} onOpenChange={setEmojiOpen}>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  aria-label={t('library.config.basic.pick_avatar')}
                  className="h-auto min-h-0 rounded-[20%] p-0 text-foreground shadow-none transition-opacity hover:bg-transparent hover:text-foreground hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring/50">
                  <EmojiAvatar size={48} fontSize={24}>
                    {form.avatar || '🤖'}
                  </EmojiAvatar>
                </Button>
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
                    className={`flex size-7 min-h-0 items-center justify-center rounded-2xs font-normal text-sm shadow-none transition-all focus-visible:ring-0 ${
                      active ? 'bg-accent ring-1 ring-primary/20' : 'hover:bg-accent/50'
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
        <FieldLabel className="font-normal text-sm text-muted-foreground/80">
          {t('library.config.agent.field.name.label')}
        </FieldLabel>
        <FieldContent>
          <Input
            value={form.name}
            onChange={(e) => onChange({ name: e.target.value })}
            placeholder={t('library.config.agent.field.name.placeholder')}
            aria-invalid={Boolean(nameError) || undefined}
            className="rounded-xs border-border/20 bg-accent/15 text-xs focus:border-border/40 focus:bg-accent/20 aria-invalid:border-destructive/50"
          />
          <FieldError className="text-xs" errors={nameError ? [{ message: nameError }] : undefined} />
        </FieldContent>
      </Field>

      <ModelSubsection>
        <ModelField
          label={t('library.config.agent.field.model.label')}
          hint={t('library.config.agent.field.model.hint')}
          value={form.model}
          modelsById={modelsById}
          errorMessage={modelError}
          onSelect={(modelId) => onChange({ model: modelId })}
        />
        <ModelField
          label={t('library.config.agent.field.plan_model.label')}
          hint={t('library.config.agent.field.plan_model.hint')}
          value={form.planModel}
          modelsById={modelsById}
          allowClear
          onSelect={(modelId) => onChange({ planModel: modelId })}
        />
        <ModelField
          label={t('library.config.agent.field.small_model.label')}
          hint={t('library.config.agent.field.small_model.hint')}
          value={form.smallModel}
          modelsById={modelsById}
          allowClear
          onSelect={(modelId) => onChange({ smallModel: modelId })}
        />
      </ModelSubsection>

      <Field className="gap-1.5">
        <FieldLabel className="font-normal text-sm text-muted-foreground/80">
          {t('library.config.agent.field.accessible_paths.label')}
        </FieldLabel>
        <FieldContent>
          <div className="flex flex-col gap-1.5">
            {form.accessiblePaths.length === 0 ? (
              <FieldDescription className="text-xs text-muted-foreground/50">
                {t('library.config.agent.field.accessible_paths.empty')}
              </FieldDescription>
            ) : null}
            {form.accessiblePaths.map((p) => (
              <div
                key={p}
                className="flex items-center gap-2 rounded-xs border border-border/15 bg-accent/15 px-3 py-2">
                <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground/80" title={p}>
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
              className="mt-1 h-auto min-h-0 w-fit rounded-2xs border border-border/20 border-dashed px-2.5 py-1 font-normal text-xs text-muted-foreground/60 shadow-none transition hover:bg-accent/50 hover:text-foreground focus-visible:ring-0">
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
          <FieldLabel className="font-normal text-sm text-muted-foreground/80">
            {t('library.config.agent.field.heartbeat_interval.label')}
          </FieldLabel>
          <FieldContent>
            <EditableNumber
              block
              min={1}
              max={1440}
              step={1}
              precision={0}
              align="start"
              changeOnBlur
              value={form.heartbeatInterval || null}
              onChange={(v) => onChange({ heartbeatInterval: typeof v === 'number' ? v : 0 })}
              className="rounded-xs border-border/20 bg-accent/15 text-xs focus-visible:border-border/40 focus-visible:bg-accent/20 focus-visible:ring-0"
            />
          </FieldContent>
        </Field>
      ) : null}

      <Field className="gap-1.5">
        <FieldLabel className="font-normal text-sm text-muted-foreground/80">
          {t('library.config.agent.field.description.label')}
        </FieldLabel>
        <FieldContent>
          <Textarea.Input
            value={form.description}
            onChange={(e) => onChange({ description: e.target.value })}
            placeholder={t('library.config.agent.field.description.placeholder')}
            className="min-h-18 rounded-xs border-border/20 bg-accent/15 px-3 py-2 text-xs focus:border-border/40 focus:bg-accent/20"
          />
        </FieldContent>
      </Field>

      <Field className="gap-1.5">
        <FieldLabel className="font-normal text-sm text-muted-foreground/80">
          {t('library.config.basic.tags')}
        </FieldLabel>
        <FieldContent>
          <Combobox
            multiple
            searchable
            options={tagOptions}
            value={form.tags}
            onChange={(v) => onChange({ tags: Array.isArray(v) ? v : v ? [v] : [] })}
            placeholder={t('library.config.basic.tag_placeholder')}
            searchPlaceholder={t('library.config.basic.tag_search')}
            emptyText={t('library.config.basic.tag_empty')}
            className="min-h-8 w-full items-center rounded-xs border-border/20 bg-accent/15 px-2 py-1 text-xs shadow-none transition-all hover:border-border/40 hover:bg-accent/20 aria-expanded:border-border/40 aria-expanded:bg-accent/20 aria-expanded:ring-0"
            popoverClassName="rounded-xs border-border/30 p-1 shadow-lg shadow-black/[0.06]"
            renderValue={(value) => {
              const selected = Array.isArray(value) ? value : value ? [value] : []
              const hasSelection = selected.length > 0
              return (
                <div className="flex min-w-0 flex-1 items-center gap-1.5">
                  <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
                    {hasSelection ? (
                      selected.map((name) => (
                        <Badge
                          key={name}
                          variant="outline"
                          className="gap-1.5 border-border/40 bg-card py-0.5 pr-1 pl-2 font-normal shadow-2xs shadow-black/[0.03] hover:border-border/60">
                          <span
                            className="size-1.5 shrink-0 rounded-full"
                            style={{ backgroundColor: tagColor(name) }}
                            aria-hidden="true"
                          />
                          <span>{name}</span>
                          <button
                            type="button"
                            aria-label={t('common.remove')}
                            onPointerDown={(e) => e.stopPropagation()}
                            onMouseDown={(e) => e.stopPropagation()}
                            onClick={(e) => {
                              e.stopPropagation()
                              e.preventDefault()
                              onChange({ tags: form.tags.filter((tag) => tag !== name) })
                            }}
                            className="ml-0.5 inline-flex size-3.5 shrink-0 items-center justify-center rounded-full text-muted-foreground/50 transition-colors hover:bg-foreground/10 hover:text-foreground focus-visible:outline-none">
                            <X size={9} />
                          </button>
                        </Badge>
                      ))
                    ) : (
                      <span className="text-muted-foreground/50">{t('library.config.basic.tag_placeholder')}</span>
                    )}
                  </div>
                  {hasSelection && (
                    <button
                      type="button"
                      aria-label={t('common.clear')}
                      onPointerDown={(e) => e.stopPropagation()}
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation()
                        e.preventDefault()
                        onChange({ tags: [] })
                      }}
                      className="inline-flex size-3 shrink-0 items-center justify-center rounded-full text-muted-foreground/40 transition-colors hover:bg-foreground/10 hover:text-foreground focus-visible:outline-none">
                      <X size={8} />
                    </button>
                  )}
                </div>
              )
            }}
            renderOption={(option) => {
              const checked = form.tags.includes(option.value)
              const color = tagColor(option.value)
              return (
                <>
                  <span
                    className="size-2 shrink-0 rounded-full transition-all duration-200"
                    style={{
                      backgroundColor: color,
                      boxShadow: checked ? `0 0 0 2.5px ${color}33` : undefined
                    }}
                    aria-hidden="true"
                  />
                  <span
                    className={`flex-1 truncate text-xs transition-colors ${
                      checked ? 'text-foreground' : 'text-muted-foreground/80'
                    }`}>
                    {option.label}
                  </span>
                  {checked && <Check size={12} className="shrink-0 text-foreground" />}
                </>
              )
            }}
          />
          <FieldDescription className="text-xs text-muted-foreground/50">
            {t('library.config.basic.tag_hint')}
          </FieldDescription>
        </FieldContent>
      </Field>
    </div>
  )
}

function ModelSubsection({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation()
  return (
    <FieldSet className="gap-3">
      <FieldSeparator className="text-muted-foreground/80 [&>[data-slot=field-separator-content]]:bg-background [&>[data-slot=field-separator-content]]:font-normal">
        {t('library.config.agent.model_config')}
      </FieldSeparator>
      {children}
    </FieldSet>
  )
}

function ModelField({
  label,
  hint,
  value,
  modelsById,
  allowClear = false,
  errorMessage,
  onSelect
}: {
  label: string
  hint: string
  value: string
  modelsById: ReadonlyMap<UniqueModelId, Model>
  allowClear?: boolean
  errorMessage?: string
  onSelect: (modelId: UniqueModelId | '') => void
}) {
  const { t } = useTranslation()
  const invalid = Boolean(errorMessage)
  const selectorValue = toSelectorValue(value)
  const selectedModel = selectorValue ? modelsById.get(selectorValue) : undefined
  const triggerLabel = selectedModel?.name ?? (value || t('library.config.basic.model_pick'))

  return (
    <Field data-invalid={invalid || undefined} className="gap-1.5">
      <div className="flex items-center justify-between gap-3">
        <FieldLabel className="font-normal text-sm text-muted-foreground/80">{label}</FieldLabel>
        <span className="text-xs text-muted-foreground/50">{hint}</span>
      </div>
      <FieldContent>
        <div
          className={`rounded-xs border bg-accent/15 transition-colors ${
            invalid ? 'border-destructive/50' : 'border-border/20'
          }`}>
          <div className="flex items-center gap-1.5 px-2 py-1">
            <ModelSelector
              multiple={false}
              selectionType="id"
              value={selectorValue}
              filter={isSelectableAgentModel}
              onSelect={(modelId) => onSelect(modelId ?? '')}
              trigger={
                <Button
                  type="button"
                  variant="ghost"
                  className="flex h-auto min-h-0 min-w-0 flex-1 items-center justify-between gap-1.5 rounded-[12px] px-2 py-1 font-normal text-xs text-foreground shadow-none hover:bg-accent/50 focus-visible:ring-0">
                  <span className="min-w-0 truncate">{triggerLabel}</span>
                  <ChevronsUpDown size={12} className="shrink-0 text-muted-foreground/50" />
                </Button>
              }
            />
            {allowClear && value ? (
              <Tooltip content={t('library.config.basic.model_clear')}>
                <Button
                  type="button"
                  variant="ghost"
                  aria-label={`${label} ${t('library.config.basic.model_clear')}`}
                  onClick={() => onSelect('')}
                  className="flex h-6 min-h-0 w-6 shrink-0 items-center justify-center rounded-3xs font-normal text-muted-foreground/50 shadow-none transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:ring-0">
                  <Trash2 size={12} />
                </Button>
              </Tooltip>
            ) : null}
          </div>
        </div>
        <FieldError className="text-xs" errors={errorMessage ? [{ message: errorMessage }] : undefined} />
        {value && !selectedModel ? (
          <FieldDescription className="text-xs text-muted-foreground/50">
            {t('library.config.basic.model_not_found', { id: value })}
          </FieldDescription>
        ) : null}
      </FieldContent>
    </Field>
  )
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
    <div className="rounded-xs border border-border/15 bg-accent/15 px-3 py-2.5">
      <DescriptionSwitch
        label={label}
        description={help}
        size="sm"
        checked={checked}
        onCheckedChange={onCheckedChange}
      />
    </div>
  )
}

export default BasicSection
