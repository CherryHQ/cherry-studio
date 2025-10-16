import { UNKNOWN } from '@renderer/config/translate'
import useTranslate from '@renderer/hooks/useTranslate'
import type { TranslateLanguage, TranslateLanguageCode } from '@renderer/types'
import type { SelectProps } from 'antd'
import { Select, Space } from 'antd'
import type { ReactNode } from 'react'
import { useCallback, useMemo } from 'react'

export type LanguageOption = {
  value: TranslateLanguageCode
  label: ReactNode
}

type Props = {
  extraOptionsBefore?: LanguageOption[]
  extraOptionsAfter?: LanguageOption[]
  languageRenderer?: (lang: TranslateLanguage) => ReactNode
} & Omit<SelectProps, 'labelRender' | 'options'>

const LanguageSelect = (props: Props) => {
  const { translateLanguages, getLanguageLabel } = useTranslate()
  const { extraOptionsAfter, extraOptionsBefore, languageRenderer, ...restProps } = props

  const defaultLanguageRenderer = useCallback(
    (lang: TranslateLanguage) => {
      return (
        <Space.Compact direction="horizontal" block>
          <span role="img" aria-label={lang.emoji} style={{ marginRight: 8 }}>
            {lang.emoji}
          </span>
          {getLanguageLabel(lang.langCode)}
        </Space.Compact>
      )
    },
    [getLanguageLabel]
  )

  const labelRender = (props) => {
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
    const before = extraOptionsBefore ?? []
    const after = extraOptionsAfter ?? []
    const options = translateLanguages.map((lang) => ({
      value: lang.langCode,
      label: languageRenderer ? languageRenderer(lang) : defaultLanguageRenderer(lang)
    }))
    return [...before, ...options, ...after]
  }, [defaultLanguageRenderer, extraOptionsAfter, extraOptionsBefore, languageRenderer, translateLanguages])

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
