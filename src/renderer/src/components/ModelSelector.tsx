import {
  Avatar,
  Button,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  Popover,
  PopoverContent,
  PopoverTrigger
} from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import ModelAvatar from '@renderer/components/Avatar/ModelAvatar'
import { getModelUniqId } from '@renderer/services/ModelService'
import type { Model, Provider } from '@renderer/types'
import { matchKeywordsInString } from '@renderer/utils'
import { getFancyProviderName } from '@renderer/utils/naming'
import { sortBy } from 'lodash'
import { Check, ChevronDown, X } from 'lucide-react'
import { memo, useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface ModelOption {
  model: Model
  label: string
  searchText: string
  value: string
  providerName: string
}

interface GroupedModelOptions {
  providerName: string
  providerId: string
  options: ModelOption[]
}

interface ModelSelectorProps {
  providers?: Provider[]
  predicate?: (model: Model) => boolean
  grouped?: boolean
  showAvatar?: boolean
  showSuffix?: boolean
  value?: string
  defaultValue?: string
  onChange?: (value: string) => void
  placeholder?: string
  style?: React.CSSProperties
  className?: string
  allowClear?: boolean
  disabled?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

/**
 * 模型选择器，基于 Shadcn Popover + Command
 * - 通过传入模型服务商列表和模型 predicate 来构造选项
 * - 支持按服务商分组
 * - 可以控制 avatar 和 suffix 显示与否
 * @param providers 服务商列表
 * @param predicate 模型过滤条件
 * @param grouped 是否按服务商分组
 * @param showAvatar 是否显示模型图标
 * @param showSuffix 是否在模型名称后显示服务商作为后缀
 */
const ModelSelector = ({
  providers,
  predicate,
  grouped = true,
  showAvatar = true,
  showSuffix = true,
  value,
  defaultValue,
  onChange,
  placeholder,
  style,
  className,
  allowClear = false,
  disabled = false,
  open: controlledOpen,
  onOpenChange
}: ModelSelectorProps) => {
  const { t } = useTranslation()
  const [internalOpen, setInternalOpen] = useState(false)
  const [search, setSearch] = useState('')

  const open = controlledOpen ?? internalOpen
  const setOpen = onOpenChange ?? setInternalOpen

  // Build model options for a single provider
  const getModelOptions = useCallback(
    (p: Provider, fancyName: string): ModelOption[] => {
      return sortBy(p.models, 'name')
        .filter((model) => predicate?.(model) ?? true)
        .map((m) => ({
          model: m,
          label: m.name,
          searchText: `${m.name} | ${fancyName}`,
          value: getModelUniqId(m),
          providerName: fancyName
        }))
    },
    [predicate]
  )

  // Build grouped options
  const groupedOptions = useMemo((): GroupedModelOptions[] => {
    if (!providers) return []

    return providers
      .map((p) => {
        const fancyName = getFancyProviderName(p)
        const options = getModelOptions(p, fancyName)
        return {
          providerName: fancyName,
          providerId: p.id,
          options
        }
      })
      .filter((group) => group.options.length > 0)
  }, [providers, getModelOptions])

  // Flat options for non-grouped mode
  const flatOptions = useMemo((): ModelOption[] => {
    return groupedOptions.flatMap((group) => group.options)
  }, [groupedOptions])

  // Find selected option
  const selectedOption = useMemo(() => {
    const currentValue = value ?? defaultValue
    if (!currentValue) return null
    return flatOptions.find((opt) => opt.value === currentValue) ?? null
  }, [value, defaultValue, flatOptions])

  // Custom filter function for cmdk
  const filterOptions = useCallback(
    (optionValue: string, searchText: string) => {
      const option = flatOptions.find((opt) => opt.value === optionValue)
      if (!option) return 0
      return matchKeywordsInString(searchText, option.searchText) ? 1 : 0
    },
    [flatOptions]
  )

  const handleSelect = useCallback(
    (selectedValue: string) => {
      onChange?.(selectedValue)
      setOpen(false)
      setSearch('')
    },
    [onChange, setOpen]
  )

  const handleClear = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      onChange?.('')
    },
    [onChange]
  )

  // Render the trigger content (selected value display)
  const renderTriggerContent = () => {
    if (selectedOption) {
      return (
        <div className="flex items-center gap-2 truncate">
          {showAvatar && <ModelAvatar model={selectedOption.model} size={18} />}
          <span className="truncate">
            {selectedOption.label}
            {showSuffix && <span className="opacity-45">{` | ${selectedOption.providerName}`}</span>}
          </span>
        </div>
      )
    }

    // Invalid model display
    if (value && !selectedOption) {
      return (
        <div className="flex items-center gap-2">
          {showAvatar && <Avatar className="h-[18px] w-[18px]" />}
          <span className="text-muted-foreground">{t('knowledge.error.model_invalid')}</span>
        </div>
      )
    }

    return <span className="text-muted-foreground">{placeholder || t('settings.models.empty')}</span>
  }

  // Render a single option item
  const renderOptionItem = (option: ModelOption, isSelected: boolean) => (
    <CommandItem
      key={option.value}
      value={option.value}
      onSelect={handleSelect}
      className="flex cursor-pointer items-center gap-2"
      data-testid="model-option">
      <div className="flex flex-1 items-center gap-2 truncate">
        {showAvatar && <ModelAvatar model={option.model} size={18} />}
        <span className="truncate">
          {option.label}
          {showSuffix && <span className="opacity-45">{` | ${option.providerName}`}</span>}
        </span>
      </div>
      {isSelected && <Check className="size-4 shrink-0 text-primary" />}
    </CommandItem>
  )

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          style={style}
          className={cn(
            'justify-between font-normal',
            'bg-zinc-50 dark:bg-zinc-900',
            'border-border aria-expanded:border-primary aria-expanded:ring-3 aria-expanded:ring-primary/20',
            disabled && 'cursor-not-allowed opacity-50',
            className
          )}>
          {renderTriggerContent()}
          <div className="flex shrink-0 items-center gap-1">
            {allowClear && selectedOption && (
              <X className="size-4 cursor-pointer opacity-50 hover:opacity-100" onClick={handleClear} />
            )}
            <ChevronDown className="size-4 opacity-50" />
          </div>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-0" style={{ width: style?.width }} align="start">
        <Command filter={filterOptions}>
          <CommandInput
            placeholder={t('common.search') + '...'}
            value={search}
            onValueChange={setSearch}
            className="h-9"
          />
          <CommandList>
            <CommandEmpty>{t('common.no_results')}</CommandEmpty>
            {grouped
              ? groupedOptions.map((group) => (
                  <CommandGroup key={group.providerId} heading={group.providerName} data-testid="model-group">
                    {group.options.map((option) => renderOptionItem(option, option.value === (value ?? defaultValue)))}
                  </CommandGroup>
                ))
              : flatOptions.map((option) => renderOptionItem(option, option.value === (value ?? defaultValue)))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

export default memo(ModelSelector)

/**
 * 用于搜索过滤的工具函数，统一搜索行为：
 * - 优先使用 title 匹配
 * - 其次使用 label 匹配
 * - 最后使用 value 匹配
 *
 * @param input 用户输入的搜索字符串
 * @param option Select 选项对象，包含 label 或 value
 * @returns 是否匹配
 */
export function modelSelectFilter(input: string, option: any): boolean {
  const target =
    typeof option?.title === 'string'
      ? option.title
      : typeof option?.label === 'string'
        ? option.label
        : typeof option?.value === 'string'
          ? option.value
          : ''
  return matchKeywordsInString(input, target)
}
