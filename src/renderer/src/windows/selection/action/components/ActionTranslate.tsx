import { LoadingOutlined } from '@ant-design/icons'
import CopyButton from '@renderer/components/CopyButton'
import { TranslateLanguageOptions } from '@renderer/config/translate'
import db from '@renderer/databases'
import { useDefaultModel } from '@renderer/hooks/useAssistant'
import { fetchTranslate } from '@renderer/services/ApiService'
import { getDefaultTranslateAssistant } from '@renderer/services/AssistantService'
import { Assistant } from '@renderer/types'
import type { ActionItem } from '@renderer/types/selectionTypes'
import { runAsyncFunction } from '@renderer/utils'
import { Select, Space } from 'antd'
import { isEmpty } from 'lodash'
import { ChevronDown } from 'lucide-react'
import { FC, useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import WindowFooter from './WindowFooter'

interface Props {
  action: ActionItem
  scrollToBottom: () => void
}

let _targetLanguage = 'chinese'

const ActionTranslate: FC<Props> = ({ action, scrollToBottom }) => {
  const { t } = useTranslation()

  const [targetLanguage, setTargetLanguage] = useState(_targetLanguage)
  const { translateModel } = useDefaultModel()

  const [isLangSelectDisabled, setIsLangSelectDisabled] = useState(false)
  const [showOriginal, setShowOriginal] = useState(false)

  const [result, setResult] = useState('')
  const [contentToCopy, setContentToCopy] = useState('')
  const [error, setError] = useState('')

  const translatingRef = useRef(false)

  _targetLanguage = targetLanguage

  const translate = useCallback(async () => {
    if (!action.selectedText || !action.selectedText.trim() || !translateModel) return

    if (translatingRef.current) return

    try {
      translatingRef.current = true
      setError('')

      const targetLang = await db.settings.get({ id: 'translate:target:language' })
      const assistant: Assistant = getDefaultTranslateAssistant(
        targetLang?.value || targetLanguage,
        action.selectedText
      )

      const onResult = (text: string, isComplete: boolean) => {
        setResult(text)
        scrollToBottom()

        if (isComplete) {
          setContentToCopy(text)
          setIsLangSelectDisabled(false)
        }
      }

      setIsLangSelectDisabled(true)
      await fetchTranslate({ content: action.selectedText || '', assistant, onResponse: onResult })

      translatingRef.current = false
    } catch (error: any) {
      setError(error?.message || t('error.unknown'))
      console.error(error)
    } finally {
      translatingRef.current = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action, targetLanguage, translateModel])

  useEffect(() => {
    runAsyncFunction(async () => {
      const targetLang = await db.settings.get({ id: 'translate:target:language' })
      targetLang && setTargetLanguage(targetLang.value)
    })
  }, [])

  useEffect(() => {
    translate()
  }, [translate])

  return (
    <>
      <Container>
        <MenuContainer>
          <Select
            value={targetLanguage}
            style={{ maxWidth: 200, minWidth: 130, flex: 1 }}
            listHeight={160}
            optionFilterProp="label"
            options={TranslateLanguageOptions}
            onChange={async (value) => {
              await db.settings.put({ id: 'translate:target:language', value })
              setTargetLanguage(value)
            }}
            disabled={isLangSelectDisabled}
            optionRender={(option) => (
              <Space>
                <span role="img" aria-label={option.data.label}>
                  {option.data.emoji}
                </span>
                {option.label}
              </Space>
            )}
          />
          <OriginalHeader onClick={() => setShowOriginal(!showOriginal)}>
            <span>
              {showOriginal ? t('selection.action.window.original_hide') : t('selection.action.window.original_show')}
            </span>
            <ChevronDown size={14} className={showOriginal ? 'expanded' : ''} />
          </OriginalHeader>
        </MenuContainer>
        {showOriginal && (
          <OriginalContent>
            {action.selectedText}{' '}
            <OriginalContentCopyWrapper>
              <CopyButton
                textToCopy={action.selectedText!}
                tooltip={t('selection.action.window.original_copy')}
                size={12}
              />
            </OriginalContentCopyWrapper>
          </OriginalContent>
        )}
        <Result>{isEmpty(result) ? <LoadingOutlined style={{ fontSize: 16 }} spin /> : result}</Result>
        {error && <ErrorMsg>{error}</ErrorMsg>}
      </Container>
      <FooterPadding />
      <WindowFooter content={contentToCopy} />
    </>
  )
}

const Container = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  flex: 1;
  width: 100%;
`

const Result = styled.div`
  margin-top: 16px;
  white-space: pre-wrap;
  word-break: break-word;
  width: 100%;
`

const MenuContainer = styled.div`
  display: flex;
  width: 100%;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
`

const OriginalHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  cursor: pointer;
  color: var(--color-text-secondary);
  font-size: 12px;
  padding: 4px 0;

  &:hover {
    color: var(--color-primary);
  }

  .lucide {
    transition: transform 0.2s ease;
    &.expanded {
      transform: rotate(180deg);
    }
  }
`

const OriginalContent = styled.div`
  margin-top: 8px;
  padding: 8px;
  background-color: var(--color-background-soft);
  border-radius: 4px;
  color: var(--color-text-secondary);
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-word;
  width: 100%;
`

const OriginalContentCopyWrapper = styled.div`
  display: flex;
  justify-content: flex-end;
`

const FooterPadding = styled.div`
  min-height: 32px;
`

const ErrorMsg = styled.div`
  color: var(--color-error);
  background: rgba(255, 0, 0, 0.15);
  border: 1px solid var(--color-error);
  padding: 8px 12px;
  border-radius: 4px;
  margin-bottom: 12px;
  font-size: 13px;
  word-break: break-all;
`

export default ActionTranslate
