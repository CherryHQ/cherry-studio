import { SwapOutlined } from '@ant-design/icons'
import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import LanguageSelect from '@renderer/components/LanguageSelect'
import Scrollbar from '@renderer/components/Scrollbar'
import { useDefaultModel } from '@renderer/hooks/useAssistant'
import { translateText } from '@renderer/services/TranslateService'
import { formatErrorMessageWithPrefix, isAbortError } from '@renderer/utils/error'
import { Select } from 'antd'
import { isEmpty } from 'lodash'
import type { FC } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

const logger = loggerService.withContext('TranslateWindow')

interface Props {
  text: string
}

const Translate: FC<Props> = ({ text }) => {
  const [result, setResult] = useState('')
  const [targetLanguage, setTargetLanguage] = usePreference('feature.translate.mini_window.target_lang')
  const { translateModel } = useDefaultModel()
  const { t } = useTranslation()
  const translatingRef = useRef(false)

  const translate = useCallback(async () => {
    if (!text.trim() || !translateModel) return

    if (translatingRef.current) return

    try {
      translatingRef.current = true

      await translateText(text, targetLanguage, setResult)

      translatingRef.current = false
    } catch (error) {
      // User-initiated aborts shouldn't look like failures; anything else gets
      // the upstream message prefixed so the user sees why it failed.
      if (!isAbortError(error)) {
        logger.error('Error fetching result:', error as Error)
        window.toast.error(formatErrorMessageWithPrefix(error, t('translate.error.failed')))
      }
    } finally {
      translatingRef.current = false
    }
  }, [text, targetLanguage, translateModel, t])

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
