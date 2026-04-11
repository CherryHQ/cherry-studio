import { LoadingOutlined } from '@ant-design/icons'
import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import CopyButton from '@renderer/components/CopyButton'
import { useLightweightAssistantFlow } from '@renderer/hooks/useLightweightAssistantFlow'
import { PartsProvider } from '@renderer/pages/home/Messages/Blocks'
import MessageContent from '@renderer/pages/home/Messages/MessageContent'
import {
  getAssistantById,
  getDefaultAssistant,
  getDefaultModel,
  getDefaultTopic
} from '@renderer/services/AssistantService'
import { pauseTrace } from '@renderer/services/SpanManagerService'
import type { SelectionActionItem } from '@shared/data/preference/preferenceTypes'
import { ChevronDown } from 'lucide-react'
import type { FC } from 'react'
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import WindowFooter from './WindowFooter'

const logger = loggerService.withContext('ActionGeneral')
interface Props {
  action: SelectionActionItem
  scrollToBottom?: () => void
}

const ActionGeneral: FC<Props> = React.memo(({ action, scrollToBottom }) => {
  const { t } = useTranslation()
  const [language] = usePreference('app.language')
  const [showOriginal, setShowOriginal] = useState(false)
  const activeAssistant = useMemo(() => {
    const currentAssistant = action.assistantId
      ? getAssistantById(action.assistantId) || getDefaultAssistant()
      : getDefaultAssistant()

    return {
      ...currentAssistant,
      model: currentAssistant.model || getDefaultModel()
    }
  }, [action.assistantId])

  const activeTopic = useMemo(() => getDefaultTopic(activeAssistant.id), [activeAssistant.id])

  const promptContent = useMemo(() => {
    let userContent = ''
    switch (action.id) {
      case 'summary':
        userContent = t('selection.action.prompt.summary', { language }) + action.selectedText
        break
      case 'explain':
        userContent = t('selection.action.prompt.explain', { language }) + action.selectedText
        break
      case 'refine':
        userContent = t('selection.action.prompt.refine', { text: action.selectedText ?? '' })
        break
      default:
        if (!action.prompt) {
          userContent = action.selectedText || ''
          break
        }

        if (action.prompt.includes('{{text}}')) {
          userContent = action.prompt.replaceAll('{{text}}', action.selectedText!)
          break
        }

        userContent = action.prompt + '\n\n' + action.selectedText
    }
    return userContent
  }, [action, language, t])

  const { partsMap, error, isPreparing, isStreaming, content, latestAssistantMessage, run, stop } =
    useLightweightAssistantFlow({
      chatId: activeTopic.id,
      topicId: activeTopic.id,
      assistantId: activeAssistant.id,
      onStreamStart: scrollToBottom
    })

  const fetchResult = useCallback(() => {
    logger.debug('Before process message', { assistant: activeAssistant })
    void run({ assistant: activeAssistant, prompt: promptContent })
  }, [activeAssistant, promptContent, run])

  useEffect(() => {
    fetchResult()
  }, [fetchResult])

  const handlePause = () => {
    stop()
    void pauseTrace(activeTopic.id)
  }

  const handleRegenerate = () => {
    fetchResult()
  }

  return (
    <>
      <Container>
        <MenuContainer>
          <OriginalHeader onClick={() => setShowOriginal(!showOriginal)}>
            <span>
              {showOriginal ? t('selection.action.window.original_hide') : t('selection.action.window.original_show')}
            </span>
            <ChevronDown size={14} className={showOriginal ? 'expanded' : ''} />
          </OriginalHeader>
        </MenuContainer>
        {showOriginal && (
          <OriginalContent>
            {action.selectedText}
            <OriginalContentCopyWrapper>
              <CopyButton
                textToCopy={action.selectedText!}
                tooltip={t('selection.action.window.original_copy')}
                size={12}
              />
            </OriginalContentCopyWrapper>
          </OriginalContent>
        )}
        <Result>
          {isPreparing && <LoadingOutlined style={{ fontSize: 16 }} spin />}
          {!isPreparing && latestAssistantMessage && (
            <PartsProvider value={partsMap}>
              <MessageContent key={latestAssistantMessage.id} message={latestAssistantMessage} />
            </PartsProvider>
          )}
        </Result>
        {error && <ErrorMsg>{error}</ErrorMsg>}
      </Container>
      <FooterPadding />
      <WindowFooter loading={isStreaming} onPause={handlePause} onRegenerate={handleRegenerate} content={content} />
    </>
  )
})

const Container = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 100%;
`

const Result = styled.div`
  margin-top: 4px;
  width: 100%;
`

const MenuContainer = styled.div`
  display: flex;
  width: 100%;
  flex-direction: row;
  align-items: center;
  justify-content: flex-end;
`

const OriginalHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  cursor: pointer;
  color: var(--color-text-secondary);
  font-size: 12px;

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
  padding: 8px;
  margin-top: 8px;
  margin-bottom: 12px;
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
  min-height: 12px;
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

export default ActionGeneral
