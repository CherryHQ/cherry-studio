/**
 * PromptVariableConfigPanel
 *
 * ID-driven variable configuration panel for prompt template editing.
 *
 * Each variable has a stable `id` (nanoid). The `key` field is editable —
 * renaming a key updates content via the onKeyRename callback.
 *
 * Sync strategy:
 * - "Add Variable" button → generates id, default key, inserts ${key} into content
 * - Manual ${xxx} typed in content → auto-detected, id generated, config row added
 * - Key renamed in panel → content synced via onKeyRename callback
 * - Variable deleted in panel → content synced via onDeleteVariable callback
 * - ${xxx} removed from content → config row hidden (cleaned on save)
 */

import { Button, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@cherrystudio/ui'
import { extractVariableKeys, generateDefaultKey, generateVariableId } from '@renderer/utils/promptVariables'
import type { PromptVariable } from '@shared/data/types/prompt'
import { MinusCircleIcon, PlusIcon, Trash2Icon } from 'lucide-react'
import { type FC, useCallback, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

/** z-index higher than antd Modal (1000) for Radix Select portals */
const SELECT_CONTENT_CLASS = 'z-[2000]'

interface Props {
  content: string
  variables: PromptVariable[]
  onChange: (variables: PromptVariable[]) => void
  /** Called when a variable key is renamed — parent should update content */
  onKeyRename: (oldKey: string, newKey: string) => void
  /** Called when a variable is deleted — parent should remove ${key} from content */
  onDeleteVariable: (key: string) => void
  /** Called when "Add Variable" is clicked — parent should insert ${key} into content */
  onAddVariable: (key: string) => void
}

const PromptVariableConfigPanel: FC<Props> = ({
  content,
  variables,
  onChange,
  onKeyRename,
  onDeleteVariable,
  onAddVariable
}) => {
  const { t } = useTranslation()
  const prevKeysRef = useRef<string[]>([])

  const contentKeys = extractVariableKeys(content)

  // Auto-add config rows for new ${key} typed directly in content
  useEffect(() => {
    prevKeysRef.current = contentKeys

    const existingKeys = new Set(variables.map((v) => v.key))
    const newKeys = contentKeys.filter((k) => !existingKeys.has(k))

    if (newKeys.length > 0) {
      const newVars: PromptVariable[] = newKeys.map((key) => ({
        id: generateVariableId(),
        key,
        type: 'input'
      }))
      onChange([...variables, ...newVars])
    }
  }, [JSON.stringify(contentKeys)]) // eslint-disable-line react-hooks/exhaustive-deps

  // Only show variables that exist in content
  const visibleVariables = variables.filter((v) => contentKeys.includes(v.key))

  const handleAddVariable = useCallback(() => {
    const allKeys = variables.map((v) => v.key)
    const key = generateDefaultKey(allKeys)
    const newVar: PromptVariable = { id: generateVariableId(), key, type: 'input' }
    onChange([...variables, newVar])
    onAddVariable(key)
  }, [onChange, onAddVariable, variables])

  const handleDelete = useCallback(
    (id: string) => {
      const variable = variables.find((v) => v.id === id)
      if (!variable) return
      onChange(variables.filter((v) => v.id !== id))
      onDeleteVariable(variable.key)
    },
    [onChange, onDeleteVariable, variables]
  )

  const handleKeyChange = useCallback(
    (id: string, newKey: string) => {
      const variable = variables.find((v) => v.id === id)
      if (!variable || variable.key === newKey) return

      onChange(variables.map((v) => (v.id === id ? ({ ...v, key: newKey } as PromptVariable) : v)))
      onKeyRename(variable.key, newKey)
    },
    [onChange, onKeyRename, variables]
  )

  const updateVariable = useCallback(
    (id: string, updates: Partial<PromptVariable>) => {
      onChange(
        variables.map((v) => {
          if (v.id !== id) return v
          return { ...v, ...updates } as PromptVariable
        })
      )
    },
    [onChange, variables]
  )

  const handleTypeChange = useCallback(
    (id: string, newType: 'input' | 'select') => {
      onChange(
        variables.map((v) => {
          if (v.id !== id) return v
          if (newType === 'input') {
            return { id: v.id, key: v.key, type: 'input' as const, defaultValue: v.defaultValue }
          }
          return { id: v.id, key: v.key, type: 'select' as const, defaultValue: undefined, options: [''] }
        })
      )
    },
    [onChange, variables]
  )

  return (
    <div className="mt-3 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-[var(--color-text-2)] text-xs">{t('settings.prompts.variablesConfig')}</span>
        <Button variant="ghost" size="sm" onClick={handleAddVariable}>
          <PlusIcon size={14} />
          {t('settings.prompts.addVariable')}
        </Button>
      </div>

      {visibleVariables.map((variable) => (
        <VariableConfigRow
          key={variable.id}
          variable={variable}
          onKeyChange={handleKeyChange}
          onTypeChange={handleTypeChange}
          onUpdate={updateVariable}
          onDelete={handleDelete}
        />
      ))}
    </div>
  )
}

interface VariableConfigRowProps {
  variable: PromptVariable
  onKeyChange: (id: string, newKey: string) => void
  onTypeChange: (id: string, type: 'input' | 'select') => void
  onUpdate: (id: string, updates: Partial<PromptVariable>) => void
  onDelete: (id: string) => void
}

const VariableConfigRow: FC<VariableConfigRowProps> = ({ variable, onKeyChange, onTypeChange, onUpdate, onDelete }) => {
  const { t } = useTranslation()

  return (
    <div className="space-y-2 rounded border border-[var(--color-border)] p-3">
      {/* Row header: editable key + type selector + delete */}
      <div className="flex items-center gap-2">
        <span className="text-[var(--color-text-3)] text-xs">$&#123;</span>
        <Input
          className="h-7 w-28 font-mono text-xs"
          value={variable.key}
          onChange={(e) => onKeyChange(variable.id, e.target.value)}
        />
        <span className="text-[var(--color-text-3)] text-xs">&#125;</span>
        <Select value={variable.type} onValueChange={(v: 'input' | 'select') => onTypeChange(variable.id, v)}>
          <SelectTrigger size="sm" className="w-24">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className={SELECT_CONTENT_CLASS}>
            <SelectItem value="input">{t('settings.prompts.variableTypeInput')}</SelectItem>
            <SelectItem value="select">{t('settings.prompts.variableTypeSelect')}</SelectItem>
          </SelectContent>
        </Select>
        <button
          type="button"
          onClick={() => onDelete(variable.id)}
          className="ml-auto shrink-0 text-[var(--color-text-3)] hover:text-[var(--color-error)]">
          <Trash2Icon size={14} />
        </button>
      </div>

      {/* Type-specific config */}
      {variable.type === 'input' && <InputVariableConfig variable={variable} onUpdate={onUpdate} />}
      {variable.type === 'select' && <SelectVariableConfig variable={variable} onUpdate={onUpdate} />}
    </div>
  )
}

const InputVariableConfig: FC<{
  variable: PromptVariable & { type: 'input' }
  onUpdate: (id: string, updates: Partial<PromptVariable>) => void
}> = ({ variable, onUpdate }) => {
  const { t } = useTranslation()

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="w-20 shrink-0 text-[var(--color-text-3)] text-xs">{t('settings.prompts.placeholder')}</span>
        <Input
          className="h-7 text-xs"
          value={variable.placeholder ?? ''}
          onChange={(e) => onUpdate(variable.id, { placeholder: e.target.value || undefined })}
          placeholder={t('settings.prompts.placeholderHint')}
        />
      </div>
      <div className="flex items-center gap-2">
        <span className="w-20 shrink-0 text-[var(--color-text-3)] text-xs">{t('settings.prompts.defaultValue')}</span>
        <Input
          className="h-7 text-xs"
          value={variable.defaultValue ?? ''}
          onChange={(e) => onUpdate(variable.id, { defaultValue: e.target.value || undefined })}
          placeholder={t('settings.prompts.defaultValueHint')}
        />
      </div>
    </div>
  )
}

const SelectVariableConfig: FC<{
  variable: PromptVariable & { type: 'select' }
  onUpdate: (id: string, updates: Partial<PromptVariable>) => void
}> = ({ variable, onUpdate }) => {
  const { t } = useTranslation()
  const options = variable.options ?? []

  const updateOptions = (newOptions: string[]) => {
    const validOptions = newOptions.length > 0 ? newOptions : ['']
    const defaultValue =
      variable.defaultValue && validOptions.includes(variable.defaultValue) ? variable.defaultValue : undefined
    onUpdate(variable.id, { options: validOptions, defaultValue })
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="w-20 shrink-0 text-[var(--color-text-3)] text-xs">{t('settings.prompts.defaultValue')}</span>
        <Select
          value={variable.defaultValue ?? ''}
          onValueChange={(v) => onUpdate(variable.id, { defaultValue: v || undefined })}>
          <SelectTrigger size="sm" className="h-7 flex-1 text-xs">
            <SelectValue placeholder={t('settings.prompts.defaultValueHint')} />
          </SelectTrigger>
          <SelectContent className={SELECT_CONTENT_CLASS}>
            {options.filter(Boolean).map((opt) => (
              <SelectItem key={opt} value={opt}>
                {opt}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-[var(--color-text-3)] text-xs">{t('settings.prompts.options')}</span>
        {options.map((opt, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <Input
              className="h-7 flex-1 text-xs"
              value={opt}
              onChange={(e) => {
                const newOptions = [...options]
                newOptions[i] = e.target.value
                updateOptions(newOptions)
              }}
              placeholder={`${t('settings.prompts.option')} ${i + 1}`}
            />
            {options.length > 1 && (
              <button
                type="button"
                onClick={() => updateOptions(options.filter((_, idx) => idx !== i))}
                className="shrink-0 text-[var(--color-text-3)] hover:text-[var(--color-error)]">
                <MinusCircleIcon size={14} />
              </button>
            )}
          </div>
        ))}
        <Button variant="ghost" size="sm" className="self-start" onClick={() => updateOptions([...options, ''])}>
          <PlusIcon size={14} />
          {t('settings.prompts.addOption')}
        </Button>
      </div>
    </div>
  )
}

export default PromptVariableConfigPanel
