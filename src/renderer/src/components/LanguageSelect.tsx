import { Skeleton } from '@cherrystudio/ui'
import { UNKNOWN } from '@renderer/config/translate'
import { useLanguages } from '@renderer/hooks/translate/useLanguages'
import type { TranslateLanguageVo } from '@renderer/types'
import type { TranslateSourceLanguage } from '@shared/data/preference/preferenceTypes'
import type { SelectProps } from 'antd'
import { Select, Space } from 'antd'
import type { ReactNode } from 'react'
import { useCallback, useMemo } from 'react'

export type LanguageOption = {
  value: TranslateSourceLanguage
  label: ReactNode
}

type Props = {
  extraOptionsBefore?: LanguageOption[]
  extraOptionsAfter?: LanguageOption[]
  languageRenderer?: (lang: TranslateLanguageVo) => ReactNode
} & Omit<SelectProps, 'labelRender' | 'options'>

const LanguageSelect = (props: Props) => {
  const { languages, getLabel } = useLanguages()
  const { extraOptionsAfter, extraOptionsBefore, languageRenderer, ...restProps } = props

  const defaultLanguageRenderer = useCallback(
    (lang: TranslateLanguageVo) => {
      return (
        <Space.Compact direction="horizontal" block>
          <span role="img" aria-label={lang.emoji} style={{ marginRight: 8 }}>
            {lang.emoji}
          </span>
          {getLabel(lang, false)}
        </Space.Compact>
      )
    },
    [getLabel]
  )

  const labelRender: NonNullable<SelectProps['labelRender']> = (props) => {
    const { label } = props
    if (label) {
      return label
    } else if (languageRenderer) {
      return languageRenderer(UNKNOWN)
    } else {
      return defaultLanguageRenderer(UNKNOWN)
    }
  }

  const displayedOptions = useMemo(() => {
    if (languages === undefined) {
      return undefined
    }
    const before = extraOptionsBefore ?? []
    const after = extraOptionsAfter ?? []
    const options = languages.map((lang) => ({
      value: lang.langCode,
      label: languageRenderer ? languageRenderer(lang) : defaultLanguageRenderer(lang)
    }))
    return [...before, ...options, ...after]
  }, [defaultLanguageRenderer, extraOptionsAfter, extraOptionsBefore, languageRenderer, languages])

  if (!languages) {
    return <Skeleton className="min-w-37.5" />
  }

  return (
    <Select
      {...restProps}
      labelRender={labelRender}
      options={displayedOptions}
      style={{ minWidth: 150, ...props.style }}
    />
  )
}

export default LanguageSelect
