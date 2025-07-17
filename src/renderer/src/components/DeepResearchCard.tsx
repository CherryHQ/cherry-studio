import { getTopicByMessageId } from '@renderer/hooks/useMessageOperations'
import Markdown from '@renderer/pages/home/Markdown/Markdown'
import { useAppDispatch } from '@renderer/store'
import { retryDeepResearchClarificationThunk } from '@renderer/store/thunk/messageThunk'
import { DeepResearchMessageBlock, MessageBlockStatus } from '@renderer/types/newMessage'
import { deepResearchConfirmation } from '@renderer/utils/deepResearchConfirmation'
import { Button, Input } from 'antd'
import { Brain, RotateCcw } from 'lucide-react'
import { FC, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import SvgSpinners180Ring from './Icons/SvgSpinners180Ring'

const { TextArea } = Input

interface DeepResearchCardProps {
  block: DeepResearchMessageBlock
}

const DeepResearchCard: FC<DeepResearchCardProps> = ({ block }) => {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const [isRetrying, setIsRetrying] = useState(false)
  const [userSupplementInfo, setUserSupplementInfo] = useState('')

  const {
    metadata: { deepResearchState }
  } = block
  const isWaitingForContinue = deepResearchState.phase === 'waiting_confirmation'

  const onContinueResearch = () => {
    try {
      const success = deepResearchConfirmation.triggerResolver(block.id, userSupplementInfo)
      if (!success) {
        console.error('[continueDeepResearchThunk] No continue resolver found for message', block.id)
        return
      }
      // resolver会在fetchDeepResearch的onResearchStarted中处理后续的研究阶段逻辑
    } catch (error) {
      console.error('[continueDeepResearchThunk] Error:', error)
    }
  }

  const onRetryResearch = async () => {
    try {
      setIsRetrying(true)
      const topic = await getTopicByMessageId(block.messageId)
      if (!topic) {
        console.error('[onRetryResearch] Topic not found for message', block.messageId)
        return
      }
      // 重试时清空补全信息
      setUserSupplementInfo('')
      dispatch(retryDeepResearchClarificationThunk(topic.id, block.messageId))
    } catch (error) {
      console.error('[onRetryResearch] Error:', error)
    } finally {
      setIsRetrying(false)
    }
  }

  return (
    <>
      {block.status === MessageBlockStatus.PENDING ? (
        <SvgSpinners180Ring color="var(--color-text-2)" style={{ marginBottom: 15 }} />
      ) : (
        <CardContainer>
          <ClarificationSection>
            <SectionTitle>
              <Brain size={16} />
              {t('research.clarification.title')}
            </SectionTitle>
            {block.content ? (
              <Markdown block={block} />
            ) : deepResearchState.phase === 'clarification' && block.status === MessageBlockStatus.STREAMING ? (
              <SvgSpinners180Ring color="var(--color-text-2)" style={{ marginBottom: 15 }} />
            ) : null}
          </ClarificationSection>

          {isWaitingForContinue && (
            <ActionSection>
              <ActionTitle>{t('research.ready_to_start')}</ActionTitle>

              <SupplementSection>
                <SupplementLabel>{t('research.supplement_info_label')}</SupplementLabel>
                <StyledTextArea
                  value={userSupplementInfo}
                  onChange={(e) => setUserSupplementInfo(e.target.value)}
                  placeholder={t('research.supplement_info_placeholder')}
                  rows={3}
                  maxLength={500}
                />
              </SupplementSection>

              <ButtonGroup>
                <RetryButton
                  type="default"
                  icon={<RotateCcw size={16} />}
                  onClick={onRetryResearch}
                  loading={isRetrying}
                  disabled={isRetrying}>
                  {t('research.retry')}
                </RetryButton>
                <ContinueButton type="primary" icon={<Brain size={16} />} onClick={onContinueResearch}>
                  {t('research.continue_research')}
                </ContinueButton>
              </ButtonGroup>
            </ActionSection>
          )}
        </CardContainer>
      )}
    </>
  )
}

const CardContainer = styled.div`
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-background);
  margin: 12px 0;
  overflow: hidden;
`

const ClarificationSection = styled.div`
  padding: 16px;
  border-bottom: 1px solid var(--color-border-soft);
`

const SectionTitle = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 500;
  color: var(--color-text);
  margin-bottom: 12px;
`

const ActionSection = styled.div`
  padding: 16px;
  background: var(--color-background-soft);
`

const ActionTitle = styled.div`
  font-size: 14px;
  font-weight: 500;
  color: var(--color-text);
  margin-bottom: 12px;
`

const ButtonGroup = styled.div`
  display: flex;
  gap: 8px;
`

const RetryButton = styled(Button)`
  display: flex;
  align-items: center;
  gap: 4px;
`

const ContinueButton = styled(Button)`
  display: flex;
  align-items: center;
  gap: 4px;
`

const SupplementSection = styled.div`
  margin-bottom: 12px;
`

const SupplementLabel = styled.div`
  font-size: 14px;
  font-weight: 500;
  color: var(--color-text);
  margin-bottom: 8px;
`

const StyledTextArea = styled(TextArea)`
  width: 100%;
`

export default DeepResearchCard
