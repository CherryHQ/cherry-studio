import {
  Button,
  Combobox,
  type ComboboxOption,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Textarea
} from '@cherrystudio/ui'
// TODO(v2-llm-migration): three entry points below are the only remaining
// Redux touch-points in the entire `pages/library` tree. They form one
// closed loop and should be ripped out together in the llm-migration PR:
//
//   1. `ModelAvatar` — requires a full v1 `Model` object; the avatar's
//      provider-icon decision reads Redux providers indirectly.
//   2. `SelectChatModelPopup.show(...)` — picker UI whose option list is
//      sourced from Redux providers + their models.
//   3. `useProviders()` — only used here to reverse-look up `form.modelId`
//      (UniqueModelId) into a full `Model` object so we can feed (1) and (2).
//
// Everything that needs to survive this migration (display name, modelId)
// already lives on `assistant.modelName` / `assistant.modelId` via v2
// AssistantService. Recommended replacement, inside this directory:
//   - `library/components/V2ModelAvatar` — consumes `useQuery('/models/:id')`
//   - `library/components/V2ModelPicker` — Combobox on `useQuery('/models')`
// so the library tree becomes self-contained, and `SelectChatModelPopup` /
// `ModelAvatar` can be rewritten or swapped at the global level separately.
import ModelAvatar from '@renderer/components/Avatar/ModelAvatar'
import EmojiPicker from '@renderer/components/EmojiPicker'
import { SelectChatModelPopup } from '@renderer/components/Popups/SelectModelPopup'
import { useProviders } from '@renderer/hooks/useProvider'
import type { Assistant, AssistantSettings } from '@shared/data/types/assistant'
import { createUniqueModelId, parseUniqueModelId } from '@shared/data/types/model'
import { Plus, Trash2 } from 'lucide-react'
import type { FC, ReactNode } from 'react'
import { useMemo, useState } from 'react'

import { isSelectableAssistantModel } from '../../assistantModelFilter'
import { DEFAULT_TAG_COLOR, TAG_COLORS } from '../../constants'

type CustomParameter = AssistantSettings['customParameters'][number]
type CustomParameterType = CustomParameter['type']

// Fallbacks applied only when the backend row doesn't have a value — mirrors
// original AssistantModelSettings defaults. `enable*` is false by default
// (matches DEFAULT_ASSISTANT_SETTINGS): the sampling parameter is NOT sent to
// the LLM unless the user explicitly opts in.
const UI_DEFAULT_TEMPERATURE = 1.0
const UI_DEFAULT_TOP_P = 1
const UI_DEFAULT_MAX_TOKENS = 4096
const UI_DEFAULT_CONTEXT_COUNT = 5
const UI_MAX_CONTEXT_COUNT = 20
const UI_DEFAULT_MAX_TOOL_CALLS = 20

const AVATAR_OPTIONS = ['🤖', '💬', '✍️', '🎓', '💻', '🎨', '📝', '🌟', '🔮', '⚡', '🎭', '📊']

export interface BasicFormState {
  name: string
  emoji: string
  description: string
  modelId: Assistant['modelId']
  temperature: number
  /** When false, temperature is omitted from the LLM request (model default). */
  enableTemperature: boolean
  topP: number
  enableTopP: boolean
  maxTokens: number
  enableMaxTokens: boolean
  contextCount: number
  streamOutput: boolean
  toolUseMode: 'function' | 'prompt'
  maxToolCalls: number
  enableMaxToolCalls: boolean
  customParameters: CustomParameter[]
  tags: string[]
  // Fields owned by other sections but kept on the same form object so a single
  // PATCH commits the whole editor — prompt / knowledge / tools sections read
  // and write these directly.
  prompt: string
  knowledgeBaseIds: string[]
  mcpServerIds: string[]
  mcpMode: AssistantSettings['mcpMode']
}

export function initialBasicFormState(assistant: Assistant): BasicFormState {
  // Per-field fallbacks when the backend row lacks a value. `enable*` defaults
  // to false (sampling param not sent to the LLM unless the user flips it on).
  const settings = assistant.settings ?? {}
  return {
    name: assistant.name,
    emoji: assistant.emoji,
    description: assistant.description,
    modelId: assistant.modelId,
    temperature: settings.temperature ?? UI_DEFAULT_TEMPERATURE,
    enableTemperature: settings.enableTemperature ?? false,
    topP: settings.topP ?? UI_DEFAULT_TOP_P,
    enableTopP: settings.enableTopP ?? false,
    maxTokens: settings.maxTokens ?? UI_DEFAULT_MAX_TOKENS,
    enableMaxTokens: settings.enableMaxTokens ?? false,
    contextCount: settings.contextCount ?? UI_DEFAULT_CONTEXT_COUNT,
    streamOutput: settings.streamOutput ?? true,
    toolUseMode: settings.toolUseMode ?? 'function',
    maxToolCalls: settings.maxToolCalls ?? UI_DEFAULT_MAX_TOOL_CALLS,
    enableMaxToolCalls: settings.enableMaxToolCalls ?? true,
    customParameters: settings.customParameters ?? [],
    tags: (assistant.tags ?? []).map((t) => t.name),
    prompt: assistant.prompt ?? '',
    knowledgeBaseIds: assistant.knowledgeBaseIds ?? [],
    mcpServerIds: assistant.mcpServerIds ?? [],
    mcpMode: settings.mcpMode ?? 'auto'
  }
}

interface Props {
  /** Present in edit mode; omitted during create. */
  assistant?: Assistant
  form: BasicFormState
  onChange: (patch: Partial<BasicFormState>) => void
  /**
   * Map of tag name → backend-assigned color (random hex chosen at POST time).
   * Used for the tag-dot icon in the Combobox options. Falls back to the
   * curated TAG_COLORS map / DEFAULT_TAG_COLOR.
   */
  tagColorByName: Map<string, string>
  /**
   * Full set of tags available in the backend. Feeds the tag-select options.
   * New tags must be created from the library page's "+ 标签" entry point —
   * this section is selection-only.
   */
  allTagNames: string[]
}

export const BasicSection: FC<Props> = ({ form, onChange, tagColorByName, allTagNames }) => {
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false)
  const tagColor = (name: string): string => tagColorByName.get(name) ?? TAG_COLORS[name] ?? DEFAULT_TAG_COLOR

  // Reverse-lookup: form.modelId (UniqueModelId) → full v1 `Model` object.
  // Only exists to feed `ModelAvatar` / `SelectChatModelPopup`; the display
  // name is already on `assistant.modelName` and does NOT need this lookup.
  // See the consolidated v2-llm-migration TODO at the top of this file.
  const { providers } = useProviders()
  const selectedModel = useMemo(() => {
    if (!form.modelId) return null
    try {
      const { providerId, modelId } = parseUniqueModelId(form.modelId)
      const provider = providers.find((p) => p.id === providerId)
      return provider?.models.find((m) => m.id === modelId) ?? null
    } catch {
      return null
    }
  }, [form.modelId, providers])

  const handlePickModel = async () => {
    const picked = await SelectChatModelPopup.show({
      model: selectedModel ?? undefined,
      filter: isSelectableAssistantModel
    })
    if (!picked) return

    // Port the legacy AssistantModelSettings model-switch heuristic:
    // certain model families expect a specific temperature to behave well.
    // Applied as a form-state patch (no mutation until 保存), matching the
    // rest of BasicSection. Tracked as tech-debt upstream (see v1 comment
    // "TODO: 移除根据模型自动修改参数的逻辑").
    const nameLower = picked.name.toLowerCase()
    const patch: Partial<BasicFormState> = {
      modelId: createUniqueModelId(picked.provider, picked.id)
    }
    if (nameLower.includes('kimi-k2')) {
      patch.temperature = 0.6
    } else if (nameLower.includes('moonshot')) {
      patch.temperature = 0.3
    }
    onChange(patch)
  }

  // Tag options for the select. `form.tags` may contain names the backend list
  // doesn't include yet (e.g. if the user typed one in the card menu before
  // /tags refreshed) — union them so they stay visible as currently-selected.
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

  return (
    <div className="max-w-lg space-y-6">
      <div>
        <h3 className="mb-1 text-[14px] text-foreground">基础设置</h3>
        <p className="text-[10px] text-muted-foreground/55">配置助手的身份信息和模型参数</p>
      </div>

      <FieldGroup label="头像">
        <div className="flex items-center gap-2">
          <Popover open={emojiPickerOpen} onOpenChange={setEmojiPickerOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label="选择头像"
                className="flex h-12 w-12 items-center justify-center rounded-2xs bg-accent/50 text-xl transition-colors hover:bg-accent/70">
                {form.emoji || '🌟'}
              </button>
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
              <button
                key={a}
                type="button"
                onClick={() => onChange({ emoji: a })}
                className={`flex h-7 w-7 items-center justify-center rounded-3xs text-sm transition-all ${
                  form.emoji === a ? 'bg-accent ring-1 ring-primary/20' : 'hover:bg-accent/40'
                }`}>
                {a}
              </button>
            ))}
          </div>
        </div>
      </FieldGroup>

      <FieldGroup label="名称">
        <Input
          value={form.name}
          onChange={(e) => onChange({ name: e.target.value })}
          className="h-auto w-full rounded-2xs border border-border/20 bg-accent/10 px-3 py-2 text-[11px] text-foreground shadow-none outline-none transition-all focus-visible:border-border/40 focus-visible:bg-accent/15 focus-visible:ring-0"
        />
      </FieldGroup>

      <FieldGroup label="简介">
        <Textarea.Input
          value={form.description}
          onValueChange={(description) => onChange({ description })}
          rows={3}
          className="min-h-0 w-full resize-none rounded-2xs border border-border/20 bg-accent/10 px-3 py-2 text-[11px] text-foreground shadow-none outline-none transition-all focus-visible:border-border/40 focus-visible:bg-accent/15 focus-visible:ring-0"
        />
      </FieldGroup>

      <FieldGroup label="标签">
        <Combobox
          multiple
          searchable
          options={tagOptions}
          value={form.tags}
          onChange={(v) => onChange({ tags: Array.isArray(v) ? v : v ? [v] : [] })}
          placeholder="选择标签"
          searchPlaceholder="搜索标签"
          emptyText="没有可选的标签"
          className="w-full"
        />
        <p className="mt-1.5 text-[9px] text-muted-foreground/40">如需新增标签,请在资源库顶部栏的「+ 标签」入口创建</p>
      </FieldGroup>

      <div className="h-px bg-border/10" />

      {/* 默认模型 */}
      <div>
        <div className="flex items-center justify-between">
          <label className="text-[10px] text-muted-foreground/60">默认模型</label>
          {selectedModel ? (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handlePickModel}
                className="flex items-center gap-1.5 rounded-full bg-accent/40 px-2 py-[3px] text-[11px] text-foreground transition-colors hover:bg-accent/60">
                <ModelAvatar model={selectedModel} size={16} />
                <span className="max-w-[180px] truncate">{selectedModel.name}</span>
              </button>
              <button
                type="button"
                onClick={() => onChange({ modelId: null })}
                title="清空"
                className="flex h-6 w-6 items-center justify-center rounded-4xs text-muted-foreground/40 transition-colors hover:bg-destructive/10 hover:text-destructive">
                <Trash2 size={12} />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={handlePickModel}
              className="rounded-full border border-border/40 border-dashed px-2.5 py-[3px] text-[10px] text-muted-foreground/50 transition-colors hover:border-border/60 hover:text-foreground">
              + 选择模型
            </button>
          )}
        </div>
        {form.modelId && !selectedModel && (
          <p className="mt-1 text-[9px] text-muted-foreground/40">模型未找到(可能被删除):{form.modelId}</p>
        )}
      </div>

      {/* 模型温度 */}
      <ToggleFieldGroup
        label="模型温度"
        valueLabel={form.enableTemperature ? form.temperature.toFixed(1) : '模型默认'}
        enabled={form.enableTemperature}
        onEnabledChange={(v) => onChange({ enableTemperature: v })}>
        <input
          type="range"
          min={0}
          max={2}
          step={0.1}
          value={form.temperature}
          onChange={(e) => onChange({ temperature: parseFloat(e.target.value) })}
          className="h-1 w-full cursor-pointer appearance-none rounded-full bg-accent/40 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-foreground"
        />
        <div className="mt-1 flex justify-between">
          <span className="text-[8px] text-muted-foreground/35">精确</span>
          <span className="text-[8px] text-muted-foreground/35">创意</span>
        </div>
      </ToggleFieldGroup>

      {/* Top-P */}
      <ToggleFieldGroup
        label="Top-P"
        valueLabel={form.enableTopP ? form.topP.toFixed(2) : '模型默认'}
        enabled={form.enableTopP}
        onEnabledChange={(v) => onChange({ enableTopP: v })}>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={form.topP}
          onChange={(e) => onChange({ topP: parseFloat(e.target.value) })}
          className="h-1 w-full cursor-pointer appearance-none rounded-full bg-accent/40 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-foreground"
        />
      </ToggleFieldGroup>

      {/* 上下文数 */}
      <FieldGroup
        label={
          <div className="flex items-center justify-between">
            <span>上下文数</span>
            <span className="text-muted-foreground/40">
              {form.contextCount >= UI_MAX_CONTEXT_COUNT ? '不限' : form.contextCount}
            </span>
          </div>
        }>
        <input
          type="range"
          min={0}
          max={UI_MAX_CONTEXT_COUNT}
          step={1}
          value={form.contextCount}
          onChange={(e) => onChange({ contextCount: parseInt(e.target.value, 10) })}
          className="h-1 w-full cursor-pointer appearance-none rounded-full bg-accent/40 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-foreground"
        />
      </FieldGroup>

      <div className="h-px bg-border/10" />

      {/* 最大 Token 数 */}
      <ToggleFieldGroup
        label="最大 Token 数"
        valueLabel={form.enableMaxTokens ? form.maxTokens.toLocaleString() : '模型默认'}
        enabled={form.enableMaxTokens}
        onEnabledChange={(v) => onChange({ enableMaxTokens: v })}>
        <Input
          type="number"
          min={1}
          value={form.maxTokens}
          onChange={(e) => {
            // Schema requires maxTokens to be a positive int — fall back to the
            // UI default instead of 0 for empty / invalid input.
            const parsed = parseInt(e.target.value, 10)
            onChange({ maxTokens: Number.isFinite(parsed) && parsed > 0 ? parsed : UI_DEFAULT_MAX_TOKENS })
          }}
          className="h-auto w-full rounded-2xs border border-border/20 bg-accent/10 px-3 py-2 text-[11px] text-foreground tabular-nums shadow-none outline-none transition-all focus-visible:border-border/40 focus-visible:bg-accent/15 focus-visible:ring-0"
        />
      </ToggleFieldGroup>

      {/* 流式输出 */}
      <div className="flex items-center justify-between">
        <label className="text-[10px] text-muted-foreground/60">流式输出</label>
        <Switch checked={form.streamOutput} onCheckedChange={(v) => onChange({ streamOutput: v })} />
      </div>

      {/* 工具调用方式 */}
      <div className="flex items-center justify-between">
        <label className="text-[10px] text-muted-foreground/60">工具调用方式</label>
        <div className="flex items-center overflow-hidden rounded-3xs border border-border/30">
          {(['function', 'prompt'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => onChange({ toolUseMode: mode })}
              className={`px-2.5 py-1 text-[10px] transition-colors ${
                form.toolUseMode === mode
                  ? 'bg-accent text-foreground'
                  : 'text-muted-foreground/60 hover:bg-accent/30 hover:text-foreground'
              }`}>
              {mode === 'function' ? '函数' : 'Prompt'}
            </button>
          ))}
        </div>
      </div>

      {/* 最大工具调用次数 */}
      <ToggleFieldGroup
        label="最大工具调用次数"
        valueLabel={form.enableMaxToolCalls ? form.maxToolCalls.toString() : '不限'}
        enabled={form.enableMaxToolCalls}
        onEnabledChange={(v) => onChange({ enableMaxToolCalls: v })}>
        <Input
          type="number"
          min={1}
          value={form.maxToolCalls}
          onChange={(e) => {
            const parsed = parseInt(e.target.value, 10)
            onChange({ maxToolCalls: Number.isFinite(parsed) && parsed > 0 ? parsed : UI_DEFAULT_MAX_TOOL_CALLS })
          }}
          className="h-auto w-full rounded-2xs border border-border/20 bg-accent/10 px-3 py-2 text-[11px] text-foreground tabular-nums shadow-none outline-none transition-all focus-visible:border-border/40 focus-visible:bg-accent/15 focus-visible:ring-0"
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

function FieldGroup({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-[10px] text-muted-foreground/60">{label}</label>
      {children}
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
        <label className="text-[10px] text-muted-foreground/60">自定义参数</label>
        <Button type="button" variant="secondary" size="sm" onClick={add} className="h-7 gap-1 px-2.5 text-[10px]">
          <Plus size={11} />
          添加参数
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
    <div className="rounded-3xs border border-border/20 bg-accent/10 p-2">
      <div className="flex items-stretch gap-2">
        <Input
          placeholder="参数名"
          value={param.name}
          onChange={(e) => onNameChange(e.target.value)}
          className="h-8 flex-1 text-[11px]"
        />
        <Select value={param.type} onValueChange={(v) => onTypeChange(v as CustomParameterType)}>
          <SelectTrigger className="h-8 w-[100px] text-[11px]">
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
                className="h-8 text-[11px] tabular-nums"
              />
            )}
            {param.type === 'boolean' && (
              <Select value={String(param.value)} onValueChange={(v) => onValueChange(v === 'true')}>
                <SelectTrigger className="h-8 text-[11px]">
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
                className="h-8 text-[11px]"
              />
            )}
          </div>
        )}
        <Button
          type="button"
          variant="destructive"
          size="icon"
          onClick={onDelete}
          className="h-8 w-8 shrink-0"
          title="删除">
          <Trash2 size={12} />
        </Button>
      </div>
      {param.type === 'json' && (
        <div className="mt-2">
          <Textarea.Input
            value={jsonString}
            onValueChange={onValueChange}
            rows={4}
            spellCheck={false}
            placeholder='{"key": "value"}'
            className={`min-h-0 w-full resize-y rounded-3xs border bg-background px-2 py-1.5 font-mono text-[11px] text-foreground shadow-none outline-none transition-all focus-visible:border-border/60 focus-visible:ring-0 ${
              jsonInvalid ? 'border-destructive/50 focus-visible:border-destructive/70' : 'border-border/20'
            }`}
          />
          {jsonInvalid && <p className="mt-1 text-[9px] text-destructive/80">JSON 格式错误</p>}
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
  enabled,
  onEnabledChange,
  children
}: {
  label: ReactNode
  valueLabel: ReactNode
  enabled: boolean
  onEnabledChange: (v: boolean) => void
  children: ReactNode
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <label className="flex items-center gap-1.5 text-[10px] text-muted-foreground/60">
          <span>{label}</span>
          <span className="text-muted-foreground/40">{valueLabel}</span>
        </label>
        <Switch checked={enabled} onCheckedChange={onEnabledChange} />
      </div>
      {enabled && <div className="mt-2">{children}</div>}
    </div>
  )
}
