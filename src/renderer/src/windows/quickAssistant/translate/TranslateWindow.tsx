import { SwapOutlined } from '@ant-design/icons'
import { usePreference } from '@data/hooks/usePreference'
import LanguageSelect from '@renderer/components/LanguageSelect'
import Scrollbar from '@renderer/components/Scrollbar'
import { useTranslate } from '@renderer/hooks/translate'
import { useDefaultModel } from '@renderer/hooks/useModels'
import { Select } from 'antd'
import { isEmpty } from 'lodash'
import type { FC } from 'react'
import { useCallback, useEffect, useState } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface Props {
  text: string
}

const Translate: FC<Props> = ({ text }) => {
  const [result, setResult] = useState('')
  const [targetLanguage, setTargetLanguage] = usePreference('feature.translate.mini_window.target_lang')
  const { translateModel } = useDefaultModel()
  const { t } = useTranslation()
  const { translate: runTranslate, isTranslating } = useTranslate({
    loggerContext: 'TranslateWindow',
    onResponse: setResult
  })

  const translate = useCallback(async () => {
    if (!text.trim() || !translateModel) return
    if (isTranslating) return
    await runTranslate(text, targetLanguage)
  }, [text, targetLanguage, translateModel, isTranslating, runTranslate])

  useEffect(() => {
    void translate()
  }, [translate])

  useHotkeys('c', () => {
    void navigator.clipboard.writeText(result)
    window.toast.success(t('message.copy.success'))
  })

  return (
    <Container>
      <MenuContainer>
        <Select
          showSearch
          value="any"
          style={{ maxWidth: 200, minWidth: 100, flex: 1 }}
          optionFilterProp="label"
          disabled
          options={[{ label: t('translate.any.language'), value: 'any' }]}
        />
        <SwapOutlined />
        <LanguageSelect
          showSearch
          value={targetLanguage}
          style={{ maxWidth: 200, minWidth: 130, flex: 1 }}
          optionFilterProp="label"
          onChange={async (value) => {
            return await setTargetLanguage(value)
          }}
        />
      </MenuContainer>
      <Main>
        {isEmpty(result) ? (
          <LoadingText>{t('translate.output.placeholder')}...</LoadingText>
        ) : (
          <OutputContainer>
            <ResultText>{result}</ResultText>
          </OutputContainer>
        )}
      </Main>
    </Container>
  )
}

const Container = styled.div`
  display: flex;
  flex-direction: column;
  flex: 1;
  padding: 12px;
  /* padding-right: 0; */
  overflow: hidden;
  -webkit-app-region: none;
`

const Main = styled.div`
  display: flex;
  flex: 1;
  width: 100%;
  overflow: hidden;
`

const ResultText = styled.div`
  white-space: pre-wrap;
  word-break: break-word;
  width: 100%;
`

const LoadingText = styled.div`
  color: var(--color-text-2);
  font-style: italic;
`

const MenuContainer = styled.div`
  display: flex;
  width: 100%;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  margin-bottom: 15px;
  gap: 20px;
`

const OutputContainer = styled(Scrollbar)`
  display: flex;
  flex-direction: column;
  flex: 1;
  gap: 10px;
`

export default Translate
