import {
  Button,
  ButtonGroup,
  EditableNumber,
  EmojiAvatar,
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
  Slider,
  Switch,
  Textarea,
  Tooltip
} from '@cherrystudio/ui'
import EmojiPicker from '@renderer/components/EmojiPicker'
import type { Assistant, AssistantSettings } from '@shared/data/types/assistant'
import type { Model, UniqueModelId } from '@shared/data/types/model'
import { Plus, Trash2 } from 'lucide-react'
import type { FC, ReactNode } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { TagSelector } from '../../../TagSelector'
import { FieldHeader } from '../../FieldHeader'
import { ModelSelectorField } from '../../ModelSelectorField'
import { ASSISTANT_CONTEXT_COUNT_MIN, type AssistantFormState } from '../descriptor'
import { isSelectableAssistantModel } from '../modelFilter'

type CustomParameter = AssistantSettings['customParameters'][number]
type CustomParameterType = CustomParameter['type']

const UI_DEFAULT_MAX_TOKENS = 4096
const UI_MAX_CONTEXT_COUNT = 20
const UI_DEFAULT_MAX_TOOL_CALLS = 20

const AVATAR_OPTIONS = ['🤖', '💬', '✍️', '🎓', '💻', '🎨', '📝', '🌟', '🔮', '⚡', '🎭', '📊']

interface Props {
  /** Present in edit mode; omitted during create. */
  assistant?: Assistant
  form: AssistantFormState
  onChange: (patch: Partial<AssistantFormState>) => void
  /** Field-level validation owned by the page/descriptor layer. */
  nameError?: string
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

export const BasicSection: FC<Props> = ({ form, onChange, nameError, tagColorByName, allTagNames }) => {
  const { t } = useTranslation()
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false)
  const nameInvalid = Boolean(nameError)

  const handleSelectModel = (modelId: UniqueModelId | null, model?: Model) => {
    if (!modelId) {
      onChange({ modelId: null })
      return
    }

    // Port the legacy AssistantModelSettings model-switch heuristic:
    // certain model families expect a specific temperature to behave well.
    // Applied as a form-state patch (no mutation until 保存), matching the
    // rest of BasicSection. Tracked as tech-debt upstream (see v1 comment
    // "TODO: 移除根据模型自动修改参数的逻辑").
    const nameLower = model?.name.toLowerCase() ?? ''
    const patch: Partial<AssistantFormState> = {
      modelId
    }
    if (nameLower.includes('kimi-k2')) {
      patch.temperature = 0.6
    } else if (nameLower.includes('moonshot')) {
      patch.temperature = 0.3
    }
    onChange(patch)
  }

  return (
    <div className="max-w-lg space-y-6">
      <div>
        <h3 className="mb-1 text-base text-foreground">{t('library.config.basic.title')}</h3>
        <p className="text-muted-foreground/60 text-xs">{t('library.config.basic.desc')}</p>
      </div>

      <Field className="gap-1.5">
        <FieldHeader label={t('common.avatar')} hint={t('library.config.basic.field.avatar.hint')} />
        <FieldContent>
          <div className="flex items-center gap-2">
            <Popover open={emojiPickerOpen} onOpenChange={setEmojiPickerOpen}>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  aria-label={t('library.config.basic.pick_avatar')}
                  className="h-auto min-h-0 rounded-[20%] p-0 text-foreground shadow-none transition-opacity hover:bg-transparent hover:text-foreground hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring/50">
                  <EmojiAvatar size={48} fontSize={24}>
                    {form.emoji || '🌟'}
                  </EmojiAvatar>
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0">
                <EmojiPicker
                  onEmojiClick={(emoji) => {
                    onChange({ emoji })
                    setEmojiPickerOpen(false)
                  }}
                />
              </PopoverContent>
            </Popover>
            <div className="flex flex-wrap gap-1">
              {AVATAR_OPTIONS.map((a) => (
                <Button
                  key={a}
                  type="button"
                  variant="ghost"
                  onClick={() => onChange({ emoji: a })}
                  className={`flex h-7 min-h-0 w-7 items-center justify-center rounded-2xs font-normal text-sm shadow-none transition-all focus-visible:ring-0 ${
                    form.emoji === a ? 'bg-accent ring-1 ring-primary/20' : 'hover:bg-accent/50'
                  }`}>
                  {a}
                </Button>
              ))}
            </div>
          </div>
        </FieldContent>
      </Field>

      <Field data-invalid={nameInvalid || undefined} className="gap-1.5">
        <FieldHeader label={t('common.name')} hint={t('library.config.basic.field.name.hint')} />
        <FieldContent>
          <Input
            value={form.name}
            onChange={(e) => onChange({ name: e.target.value })}
            placeholder={t('library.config.basic.field.name.placeholder')}
            aria-invalid={nameInvalid || undefined}
            className="h-auto w-full rounded-xs border border-border/20 bg-accent/15 px-3 py-2 text-foreground text-xs shadow-none outline-none transition-all focus-visible:border-border/40 focus-visible:bg-accent/20 focus-visible:ring-0 aria-invalid:border-destructive/50"
          />
          <FieldError className="text-xs" errors={nameError ? [{ message: nameError }] : undefined} />
        </FieldContent>
      </Field>

      <Field className="gap-1.5">
        <FieldHeader
          label={t('library.config.basic.description_label')}
          hint={t('library.config.basic.field.description.hint')}
        />
        <FieldContent>
          <Textarea.Input
            value={form.description}
            onValueChange={(description) => onChange({ description })}
            rows={3}
            placeholder={t('library.config.basic.field.description.placeholder')}
            className="min-h-0 w-full resize-none rounded-xs border border-border/20 bg-accent/15 px-3 py-2 text-foreground text-xs shadow-none outline-none transition-all focus-visible:border-border/40 focus-visible:bg-accent/20 focus-visible:ring-0"
          />
        </FieldContent>
      </Field>

      <Field className="gap-1.5">
        <FieldHeader label={t('library.config.basic.tags')} hint={t('library.config.basic.field.tags.hint')} />
        <FieldContent>
          <TagSelector
            value={form.tags}
            onChange={(tags) => onChange({ tags })}
            tagColorByName={tagColorByName}
            allTagNames={allTagNames}
          />
          <FieldDescription className="text-muted-foreground/50 text-xs">
            {t('library.config.basic.tag_hint')}
          </FieldDescription>
        </FieldContent>
      </Field>

      <Separator className="bg-border/30" />

      <ModelSelectorField
        label={t('library.config.basic.model')}
        hint={t('library.config.basic.field.model.hint')}
        value={form.modelId}
        allowClear
        filter={isSelectableAssistantModel}
        onSelect={handleSelectModel}
      />

      {/* 模型温度 */}
      <ToggleFieldGroup
        label={t('library.config.basic.temperature')}
        valueLabel={form.enableTemperature ? form.temperature.toFixed(1) : t('library.config.basic.default_value')}
        hint={t('library.config.basic.field.temperature.hint')}
        enabled={form.enableTemperature}
        onEnabledChange={(v) => onChange({ enableTemperature: v })}>
        <Slider
          size="sm"
          min={0}
          max={2}
          step={0.1}
          value={[form.temperature]}
          onValueChange={([v]) => onChange({ temperature: v })}
          className="w-full [&_[data-slot=slider-range]]:bg-accent/40 [&_[data-slot=slider-thumb]]:size-3 [&_[data-slot=slider-thumb]]:border-0 [&_[data-slot=slider-thumb]]:bg-foreground [&_[data-slot=slider-thumb]]:shadow-none [&_[data-slot=slider-thumb]]:hover:ring-0 [&_[data-slot=slider-thumb]]:hover:ring-offset-0 [&_[data-slot=slider-thumb]]:focus-visible:ring-0 [&_[data-slot=slider-track]]:h-1 [&_[data-slot=slider-track]]:bg-accent/40"
        />
        <div className="mt-1 flex justify-between">
          <span className="text-muted-foreground/50 text-xs">{t('library.config.basic.precise')}</span>
          <span className="text-muted-foreground/50 text-xs">{t('library.config.basic.creative')}</span>
        </div>
      </ToggleFieldGroup>

      {/* Top-P */}
      <ToggleFieldGroup
        label={t('library.config.basic.top_p')}
        valueLabel={form.enableTopP ? form.topP.toFixed(2) : t('library.config.basic.default_value')}
        hint={t('library.config.basic.field.top_p.hint')}
        enabled={form.enableTopP}
        onEnabledChange={(v) => onChange({ enableTopP: v })}>
        <Slider
          size="sm"
          min={0}
          max={1}
          step={0.05}
          value={[form.topP]}
          onValueChange={([v]) => onChange({ topP: v })}
          className="w-full [&_[data-slot=slider-range]]:bg-accent/40 [&_[data-slot=slider-thumb]]:size-3 [&_[data-slot=slider-thumb]]:border-0 [&_[data-slot=slider-thumb]]:bg-foreground [&_[data-slot=slider-thumb]]:shadow-none [&_[data-slot=slider-thumb]]:hover:ring-0 [&_[data-slot=slider-thumb]]:hover:ring-offset-0 [&_[data-slot=slider-thumb]]:focus-visible:ring-0 [&_[data-slot=slider-track]]:h-1 [&_[data-slot=slider-track]]:bg-accent/40"
        />
      </ToggleFieldGroup>

      {/* 上下文数 */}
      <Field className="gap-1.5">
        <FieldHeader
          label={
            <span className="flex items-center gap-1.5">
              <span>{t('library.config.basic.context_count')}</span>
              <span className="text-muted-foreground/50">
                {form.contextCount >= UI_MAX_CONTEXT_COUNT ? t('library.config.basic.unlimited') : form.contextCount}
              </span>
            </span>
          }
          hint={t('library.config.basic.field.context_count.hint')}
        />
        <FieldContent>
          <Slider
            size="sm"
            min={ASSISTANT_CONTEXT_COUNT_MIN}
            max={UI_MAX_CONTEXT_COUNT}
            step={1}
            value={[form.contextCount]}
            onValueChange={([v]) => onChange({ contextCount: Math.max(ASSISTANT_CONTEXT_COUNT_MIN, v) })}
            className="w-full [&_[data-slot=slider-range]]:bg-accent/40 [&_[data-slot=slider-thumb]]:size-3 [&_[data-slot=slider-thumb]]:border-0 [&_[data-slot=slider-thumb]]:bg-foreground [&_[data-slot=slider-thumb]]:shadow-none [&_[data-slot=slider-thumb]]:hover:ring-0 [&_[data-slot=slider-thumb]]:hover:ring-offset-0 [&_[data-slot=slider-thumb]]:focus-visible:ring-0 [&_[data-slot=slider-track]]:h-1 [&_[data-slot=slider-track]]:bg-accent/40"
          />
        </FieldContent>
      </Field>

      <Separator className="bg-border/30" />

      {/* 最大 Token 数 */}
      <ToggleFieldGroup
        label={t('library.config.basic.max_tokens')}
        valueLabel={form.enableMaxTokens ? form.maxTokens.toLocaleString() : t('library.config.basic.default_value')}
        hint={t('library.config.basic.field.max_tokens.hint')}
        enabled={form.enableMaxTokens}
        onEnabledChange={(v) => onChange({ enableMaxTokens: v })}>
        <EditableNumber
          block
          min={1}
          step={1}
          precision={0}
          align="start"
          changeOnBlur
          value={form.maxTokens}
          // Schema requires maxTokens to be a positive int — fall back to the
          // UI default for null/non-positive on commit. EditableNumber's local
          // editing state lets the user clear+retype without snapping back.
          onChange={(v) => onChange({ maxTokens: typeof v === 'number' && v > 0 ? v : UI_DEFAULT_MAX_TOKENS })}
          className="h-auto rounded-xs border-border/20 bg-accent/15 px-3 py-2 text-foreground text-xs tabular-nums shadow-none transition-all focus-visible:border-border/40 focus-visible:bg-accent/20 focus-visible:ring-0"
        />
      </ToggleFieldGroup>

      {/* 流式输出 */}
      <div className="flex items-center justify-between">
        <FieldHeader
          label={t('library.config.basic.stream_output')}
          hint={t('library.config.basic.field.stream_output.hint')}
          className="min-w-0 flex-1"
        />
        <Switch checked={form.streamOutput} onCheckedChange={(v) => onChange({ streamOutput: v })} />
      </div>

      {/* 工具调用方式 */}
      <div className="space-y-1.5">
        <FieldHeader
          label={t('library.config.basic.tool_use_mode')}
          hint={t('library.config.basic.field.tool_use_mode.hint')}
        />
        <ButtonGroup className="overflow-hidden rounded-2xs border border-border/30">
          {(['function', 'prompt'] as const).map((mode) => (
            <Button
              key={mode}
              type="button"
              variant="ghost"
              onClick={() => onChange({ toolUseMode: mode })}
              className={`h-auto min-h-0 px-2.5 py-1 font-normal text-xs shadow-none transition-colors focus-visible:ring-0 ${
                form.toolUseMode === mode
                  ? 'bg-accent text-foreground'
                  : 'text-muted-foreground/60 hover:bg-accent/50 hover:text-foreground'
              }`}>
              {t(
                mode === 'function' ? 'library.config.basic.tool_use_function' : 'library.config.basic.tool_use_prompt'
              )}
            </Button>
          ))}
        </ButtonGroup>
      </div>

      {/* 最大工具调用次数 */}
      <ToggleFieldGroup
        label={t('library.config.basic.max_tool_calls')}
        valueLabel={form.enableMaxToolCalls ? form.maxToolCalls.toString() : t('library.config.basic.unlimited')}
        hint={t('library.config.basic.field.max_tool_calls.hint')}
        enabled={form.enableMaxToolCalls}
        onEnabledChange={(v) => onChange({ enableMaxToolCalls: v })}>
        <EditableNumber
          block
          min={1}
          step={1}
          precision={0}
          align="start"
          changeOnBlur
          value={form.maxToolCalls}
          onChange={(v) => onChange({ maxToolCalls: typeof v === 'number' && v > 0 ? v : UI_DEFAULT_MAX_TOOL_CALLS })}
          className="h-auto rounded-xs border-border/20 bg-accent/15 px-3 py-2 text-foreground text-xs tabular-nums shadow-none transition-all focus-visible:border-border/40 focus-visible:bg-accent/20 focus-visible:ring-0"
        />
      </ToggleFieldGroup>

      {/* 自定义参数 */}
      <CustomParametersField
        value={form.customParameters}
        onChange={(customParameters) => onChange({ customParameters })}
      />
    </div>
  )
}

// ============================================================================
// Custom Parameters editor — mirrors the legacy `AssistantModelSettings`
// rows (name + type select + value input + delete). Uses @cherrystudio/ui
// (shadcn) primitives instead of antd so it fits the v2 UI stack.
// ============================================================================

interface CustomParametersFieldProps {
  value: CustomParameter[]
  onChange: (next: CustomParameter[]) => void
}

function defaultValueForType(type: CustomParameterType): CustomParameter['value'] {
  switch (type) {
    case 'number':
      return 0
    case 'boolean':
      return false
    case 'json':
      return ''
    default:
      return ''
  }
}

function CustomParametersField({ value, onChange }: CustomParametersFieldProps) {
  const { t } = useTranslation()

  const add = () => {
    const next: CustomParameter = { name: '', type: 'string', value: '' }
    onChange([...value, next])
  }

  const remove = (index: number) => {
    onChange(value.filter((_, i) => i !== index))
  }

  const updateField = (index: number, patch: Partial<CustomParameter>) => {
    const next = [...value] as CustomParameter[]
    // Changing `type` resets `value` to the default for the new type so the
    // discriminated-union invariant in AssistantSettingsSchema stays valid.
    if (patch.type && patch.type !== next[index].type) {
      next[index] = {
        name: next[index].name,
        type: patch.type,
        value: defaultValueForType(patch.type)
      } as CustomParameter
    } else {
      next[index] = { ...next[index], ...patch } as CustomParameter
    }
    onChange(next)
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <FieldHeader
          label={t('library.config.basic.custom_params')}
          hint={t('library.config.basic.field.custom_params.hint')}
          className="min-w-0 flex-1"
        />
        <Button type="button" variant="secondary" size="sm" onClick={add} className="h-7 gap-1 px-2.5 text-xs">
          <Plus size={11} />
          {t('library.config.basic.custom_params_add')}
        </Button>
      </div>

      {value.length > 0 && (
        <div className="mt-2 space-y-2">
          {value.map((param, index) => (
            <CustomParameterRow
              key={index}
              param={param}
              onNameChange={(name) => updateField(index, { name })}
              onTypeChange={(type) => updateField(index, { type })}
              onValueChange={(v) => updateField(index, { value: v } as Partial<CustomParameter>)}
              onDelete={() => remove(index)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function CustomParameterRow({
  param,
  onNameChange,
  onTypeChange,
  onValueChange,
  onDelete
}: {
  param: CustomParameter
  onNameChange: (name: string) => void
  onTypeChange: (type: CustomParameterType) => void
  onValueChange: (value: CustomParameter['value']) => void
  onDelete: () => void
}) {
  const { t } = useTranslation()

  const jsonString =
    param.type === 'json'
      ? typeof param.value === 'string'
        ? param.value
        : JSON.stringify(param.value ?? '', null, 2)
      : ''
  const jsonInvalid = (() => {
    if (param.type !== 'json') return false
    if (!jsonString.trim()) return false
    try {
      JSON.parse(jsonString)
      return false
    } catch {
      return true
    }
  })()

  return (
    <div className="rounded-xs border border-border/20 bg-accent/15 p-2">
      <div className="flex items-stretch gap-2">
        <Input
          placeholder={t('library.config.basic.custom_params_name')}
          value={param.name}
          onChange={(e) => onNameChange(e.target.value)}
          className="h-8 flex-1 text-xs"
        />
        <Select value={param.type} onValueChange={(v) => onTypeChange(v as CustomParameterType)}>
          <SelectTrigger className="h-8 w-[100px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="string">string</SelectItem>
            <SelectItem value="number">number</SelectItem>
            <SelectItem value="boolean">boolean</SelectItem>
            <SelectItem value="json">json</SelectItem>
          </SelectContent>
        </Select>
        {param.type !== 'json' && (
          <div className="flex-1">
            {param.type === 'number' && (
              <Input
                type="number"
                value={String(param.value)}
                onChange={(e) => {
                  const parsed = parseFloat(e.target.value)
                  onValueChange(Number.isFinite(parsed) ? parsed : 0)
                }}
                className="h-8 text-xs tabular-nums"
              />
            )}
            {param.type === 'boolean' && (
              <Select value={String(param.value)} onValueChange={(v) => onValueChange(v === 'true')}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="true">true</SelectItem>
                  <SelectItem value="false">false</SelectItem>
                </SelectContent>
              </Select>
            )}
            {param.type === 'string' && (
              <Input
                value={String(param.value)}
                onChange={(e) => onValueChange(e.target.value)}
                className="h-8 text-xs"
              />
            )}
          </div>
        )}
        <Tooltip content={t('common.delete')}>
          <Button type="button" variant="destructive" size="icon" onClick={onDelete} className="h-8 w-8 shrink-0">
            <Trash2 size={12} />
          </Button>
        </Tooltip>
      </div>
      {param.type === 'json' && (
        <div className="mt-2">
          <Textarea.Input
            value={jsonString}
            onValueChange={onValueChange}
            rows={4}
            spellCheck={false}
            placeholder='{"key": "value"}'
            className={`min-h-0 w-full resize-y rounded-xs border bg-background px-2 py-1.5 font-mono text-foreground text-xs shadow-none outline-none transition-all focus-visible:border-border/60 focus-visible:ring-0 ${
              jsonInvalid ? 'border-destructive/50 focus-visible:border-destructive/70' : 'border-border/20'
            }`}
          />
          {jsonInvalid && <p className="mt-1 text-destructive/80 text-xs">{t('library.config.basic.json_invalid')}</p>}
        </div>
      )}
    </div>
  )
}

/**
 * Two-line field with a left/right header (label + current value + switch) and
 * a body that only renders when the switch is on. Matches the legacy
 * AssistantModelSettings pattern where sampling parameters are opt-in — when
 * disabled, the value is NOT sent to the LLM (model default takes over).
 */
function ToggleFieldGroup({
  label,
  valueLabel,
  hint,
  enabled,
  onEnabledChange,
  children
}: {
  label: ReactNode
  valueLabel: ReactNode
  hint?: ReactNode
  enabled: boolean
  onEnabledChange: (v: boolean) => void
  children: ReactNode
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <FieldHeader
          label={
            <span className="flex items-center gap-1.5">
              <span>{label}</span>
              <span className="text-muted-foreground/50">{valueLabel}</span>
            </span>
          }
          hint={hint}
          className="min-w-0 flex-1"
        />
        <Switch checked={enabled} onCheckedChange={onEnabledChange} />
      </div>
      {enabled && <div className="mt-2">{children}</div>}
    </div>
  )
}
