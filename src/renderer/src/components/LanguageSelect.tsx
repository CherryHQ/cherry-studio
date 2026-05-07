import { Combobox, type ComboboxOption } from '@cherrystudio/ui'
import { UNKNOWN } from '@renderer/config/translate'
import useTranslate from '@renderer/hooks/useTranslate'
import type { TranslateLanguage, TranslateLanguageCode } from '@renderer/types'
import { cn } from '@renderer/utils/style'
import type { CSSProperties, MouseEventHandler, ReactNode } from 'react'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

export type LanguageOption = {
  value: TranslateLanguageCode
  label: ReactNode
}

type Props = {
  extraOptionsBefore?: LanguageOption[]
  extraOptionsAfter?: LanguageOption[]
  languageRenderer?: (lang: TranslateLanguage) => ReactNode
  value?: TranslateLanguageCode
  defaultValue?: TranslateLanguageCode
  onChange?: (value: TranslateLanguageCode) => void
  disabled?: boolean
  style?: CSSProperties
  className?: string
  showSearch?: boolean
  optionFilterProp?: string
  listHeight?: number
  size?: 'small' | 'middle' | 'large'
  placeholder?: string
  onClick?: MouseEventHandler<HTMLDivElement>
}

type LanguageComboboxOption = ComboboxOption & {
  content: ReactNode
  searchText: string
}

const renderTextContent = (content: ReactNode) =>
  typeof content === 'string' ? <span className="truncate">{content}</span> : content

const getOptionSearchText = (label: ReactNode, value: TranslateLanguageCode) => {
  if (typeof label === 'string') return label
  if (typeof label === 'number') return String(label)
  return value
}

const toComboboxSize = (size?: Props['size']) => {
  if (size === 'small') return 'sm'
  if (size === 'large') return 'lg'
  return 'default'
}

const LanguageSelect = (props: Props) => {
  const { translateLanguages } = useTranslate()
  const { t } = useTranslation()
  const {
    className,
    defaultValue,
    disabled,
    extraOptionsAfter,
    extraOptionsBefore,
    languageRenderer,
    listHeight,
    onChange,
    onClick,
    placeholder,
    showSearch,
    size,
    style,
    value
  } = props

  const defaultLanguageRenderer = useCallback((lang: TranslateLanguage) => {
    return (
      <span className="flex min-w-0 items-center gap-2">
        <span className="shrink-0" role="img" aria-label={lang.emoji}>
          {lang.emoji}
        </span>
        <span className="truncate">{lang.label()}</span>
      </span>
    )
  }, [])

  const renderUnknownLanguage = useCallback(() => {
    return languageRenderer ? languageRenderer(UNKNOWN) : defaultLanguageRenderer(UNKNOWN)
  }, [defaultLanguageRenderer, languageRenderer])

  const displayedOptions = useMemo<LanguageComboboxOption[]>(() => {
    const before = extraOptionsBefore ?? []
    const after = extraOptionsAfter ?? []
    const languageOptions = translateLanguages.map((lang) => {
      const content = languageRenderer ? languageRenderer(lang) : defaultLanguageRenderer(lang)
      const searchText = `${lang.langCode} ${lang.emoji} ${lang.label()}`

      return {
        value: lang.langCode,
        label: searchText,
        searchText,
        content
      }
    })

    const toExtraOption = (option: LanguageOption): LanguageComboboxOption => {
      const searchText = getOptionSearchText(option.label, option.value)

      return {
        value: option.value,
        label: searchText,
        searchText,
        content: renderTextContent(option.label)
      }
    }

    return [...before.map(toExtraOption), ...languageOptions, ...after.map(toExtraOption)]
  }, [defaultLanguageRenderer, extraOptionsAfter, extraOptionsBefore, languageRenderer, translateLanguages])

  const renderOption = useCallback((option: ComboboxOption) => {
    return (option as LanguageComboboxOption).content
  }, [])

  const renderValue = useCallback(
    (selectedValue: string | string[], options: ComboboxOption[]) => {
      const currentValue = Array.isArray(selectedValue) ? selectedValue[0] : selectedValue
      const selectedOption = options.find((option) => option.value === currentValue) as
        | LanguageComboboxOption
        | undefined

      return (
        <span className="flex min-w-0 flex-1 items-center gap-2">
          {selectedOption ? selectedOption.content : renderUnknownLanguage()}
        </span>
      )
    },
    [renderUnknownLanguage]
  )

  const filterOption = useCallback((option: ComboboxOption, search: string) => {
    const normalizedSearch = search.trim().toLowerCase()
    const languageOption = option as LanguageComboboxOption
    return [languageOption.searchText, option.value].filter(Boolean).join(' ').toLowerCase().includes(normalizedSearch)
  }, [])

  const handleChange = useCallback(
    (nextValue: string | string[]) => {
      onChange?.(Array.isArray(nextValue) ? nextValue[0] : nextValue)
    },
    [onChange]
  )

  return (
    <div className={cn('inline-flex min-w-0', className)} style={style} onClick={onClick}>
      <Combobox
        className="w-full"
        defaultValue={defaultValue}
        disabled={disabled}
        emptyText={t('common.no_results')}
        filterOption={filterOption}
        onChange={handleChange}
        options={displayedOptions}
        placeholder={placeholder ?? t('common.select')}
        popoverClassName={cn(
          'w-(--radix-popover-trigger-width)',
          listHeight && '[&_[data-slot=command-list]]:max-h-[160px]'
        )}
        renderOption={renderOption}
        renderValue={renderValue}
        searchPlaceholder={t('common.search')}
        searchable={showSearch !== false}
        searchPlacement="trigger"
        size={toComboboxSize(size)}
        value={value}
      />
    </div>
  )
}

export default LanguageSelect
