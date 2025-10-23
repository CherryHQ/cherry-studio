import { loggerService } from '@logger'
import { useAssistant, useAssistants } from '@renderer/hooks/useAssistant'
import { Assistant } from '@renderer/types'
import { Checkbox, Modal, Spin } from 'antd'
import { FC, useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

const logger = loggerService.withContext('MoveTopicsPopup')

interface MoveTopicsPopupProps {
  sourceAssistant: Assistant
  onClose: () => void
  onMoveComplete: () => void
}

const MoveTopicsPopup: FC<MoveTopicsPopupProps> = ({ sourceAssistant, onClose, onMoveComplete }) => {
  const { t } = useTranslation()
  const { assistants } = useAssistants()
  const { moveMultipleTopics } = useAssistant(sourceAssistant.id)

  const [selectedTopicIds, setSelectedTopicIds] = useState<string[]>([])
  const [selectedDestinationId, setSelectedDestinationId] = useState<string>('')
  const [isMoving, setIsMoving] = useState(false)

  // Filter out the source assistant
  const destinationAssistants = useMemo(
    () => assistants.filter((assistant) => assistant.id !== sourceAssistant.id),
    [assistants, sourceAssistant.id]
  )

  const handleTopicToggle = useCallback((topicId: string) => {
    setSelectedTopicIds((prev) => (prev.includes(topicId) ? prev.filter((id) => id !== topicId) : [...prev, topicId]))
  }, [])

  const handleSelectAll = useCallback(() => {
    if (sourceAssistant.topics.length === 0) {
      return
    }

    if (selectedTopicIds.length === sourceAssistant.topics.length) {
      setSelectedTopicIds([])
    } else {
      setSelectedTopicIds(sourceAssistant.topics.map((t) => t.id))
    }
  }, [sourceAssistant.topics, selectedTopicIds.length])

  const handleMove = useCallback(async () => {
    if (!selectedDestinationId || selectedTopicIds.length === 0) return

    const destinationAssistant = assistants.find((a) => a.id === selectedDestinationId)
    if (!destinationAssistant) return

    setIsMoving(true)
    try {
      await moveMultipleTopics(selectedTopicIds, destinationAssistant)
      onMoveComplete()
      onClose()
    } catch (error) {
      logger.error('Failed to move topics', error as Error)
      window.toast.error(t('assistants.move_topics.error'))
    } finally {
      setIsMoving(false)
    }
  }, [selectedDestinationId, selectedTopicIds, assistants, moveMultipleTopics, onMoveComplete, onClose, t])

  const canMove = selectedDestinationId && selectedTopicIds.length > 0

  return (
    <Modal
      title={t('assistants.move_topics.modal_title')}
      open={true}
      onCancel={onClose}
      onOk={handleMove}
      okText={t('assistants.move_topics.move_button')}
      okButtonProps={{ disabled: !canMove || isMoving }}
      cancelText={t('common.cancel')}
      width={600}>
      <Container>
        {isMoving && (
          <LoadingOverlay>
            <Spin size="large" />
            <div>{t('assistants.move_topics.moving')}</div>
          </LoadingOverlay>
        )}

        <Section>
          <SectionTitle>{t('assistants.move_topics.select_topics')}</SectionTitle>
          <SelectAllButton disabled={sourceAssistant.topics.length === 0} onClick={handleSelectAll}>
            {selectedTopicIds.length === sourceAssistant.topics.length
              ? t('assistants.move_topics.deselect_all')
              : t('assistants.move_topics.select_all')}
          </SelectAllButton>

          <TopicsList>
            {sourceAssistant.topics.map((topic) => (
              <TopicItem key={topic.id}>
                <Checkbox checked={selectedTopicIds.includes(topic.id)} onChange={() => handleTopicToggle(topic.id)}>
                  <TopicName>{topic.name}</TopicName>
                </Checkbox>
              </TopicItem>
            ))}
          </TopicsList>
        </Section>

        <Section>
          <SectionTitle>{t('assistants.move_topics.select_destination')}</SectionTitle>
          <DestinationSelect
            value={selectedDestinationId}
            onChange={(event) => setSelectedDestinationId(event.target.value)}>
            <option value="">{t('assistants.move_topics.select_destination_placeholder')}</option>
            {destinationAssistants.map((assistant) => (
              <option key={assistant.id} value={assistant.id}>
                {assistant.name}
              </option>
            ))}
          </DestinationSelect>
        </Section>

        {selectedTopicIds.length > 0 && selectedDestinationId && (
          <Summary>
            {t('assistants.move_topics.summary', {
              count: selectedTopicIds.length,
              destination: assistants.find((a) => a.id === selectedDestinationId)?.name
            })}
          </Summary>
        )}
      </Container>
    </Modal>
  )
}

const Container = styled.div`
  position: relative;
  max-height: 400px;
  overflow-y: auto;
`

const LoadingOverlay = styled.div`
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(255, 255, 255, 0.8);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  z-index: 1000;
`

const Section = styled.div`
  margin-bottom: 20px;
`

const SectionTitle = styled.h4`
  margin-bottom: 8px;
  color: var(--color-text-1);
  font-weight: 500;
`

const SelectAllButton = styled.button.attrs({ type: 'button' })`
  background: none;
  border: none;
  color: var(--color-primary);
  cursor: pointer;
  font-size: 12px;
  margin-bottom: 12px;
  padding: 0;

  &:hover {
    text-decoration: underline;
  }

  &:disabled {
    color: var(--color-text-4);
    cursor: not-allowed;
    text-decoration: none;
  }
`

const TopicsList = styled.div`
  max-height: 200px;
  overflow-y: auto;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  padding: 8px;
`

const TopicItem = styled.div`
  padding: 4px 0;
`

const TopicName = styled.span`
  font-size: 13px;
  color: var(--color-text-1);
`

const DestinationSelect = styled.select`
  width: 100%;
  padding: 8px 12px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-background);
  color: var(--color-text-1);
  font-size: 13px;

  &:focus {
    outline: none;
    border-color: var(--color-primary);
  }
`

const Summary = styled.div`
  margin-top: 16px;
  padding: 12px;
  background: var(--color-background-soft);
  border-radius: 6px;
  border-left: 3px solid var(--color-primary);
  font-size: 13px;
  color: var(--color-text-2);
`

export default MoveTopicsPopup
