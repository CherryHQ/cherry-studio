import { UNKNOWN } from '@renderer/config/translate'
import useTranslate from '@renderer/hooks/useTranslate'
import { Language, LanguageCode } from '@renderer/types'
import { Select, SelectProps, Space } from 'antd'
import { ReactNode, useMemo } from 'react'

export type LanguageOption = {
  value: LanguageCode
  label: ReactNode
}

type Props = {
  extraOptionsBefore?: LanguageOption[]
  extraOptionsAfter?: LanguageOption[]
  languageRenderer?: (lang: Language) => ReactNode
} & Omit<SelectProps, 'labelRender' | 'options'>

const LanguageSelect = (props: Props) => {
  const { translateLanguages } = useTranslate()
  const { extraOptionsAfter, extraOptionsBefore, languageRenderer } = props

  const labelRender = (props) => {
    const { label } = props
    if (label) {
      return label
    } else {
      return (
        <Space.Compact direction="horizontal" block>
          <span role="img" aria-label={UNKNOWN.emoji} style={{ marginRight: 8 }}>
            {UNKNOWN.emoji}
          </span>
          <Space.Compact block>{UNKNOWN.label()}</Space.Compact>
        </Space.Compact>
      )
    }
  }

  const displayedOptions = useMemo(() => {
    const before = extraOptionsBefore ?? []
    const after = extraOptionsAfter ?? []
    let options: LanguageOption[]
    if (languageRenderer) {
      options = translateLanguages.map((lang) => ({
        value: lang.langCode,
        label: languageRenderer(lang)
      }))
    } else {
      options = translateLanguages.map((lang) => ({
        value: lang.langCode,
        label: (
          <Space.Compact direction="horizontal" block>
            <span role="img" aria-label={lang.emoji} style={{ marginRight: 8 }}>
              {lang.emoji}
            </span>
            <Space.Compact block>{lang.label()}</Space.Compact>
          </Space.Compact>
        )
      }))
    }
    return [...before, ...options, ...after]
  }, [extraOptionsAfter, extraOptionsBefore, languageRenderer, translateLanguages])

  return <Select {...props} labelRender={labelRender} options={displayedOptions} />
}

export default LanguageSelect
