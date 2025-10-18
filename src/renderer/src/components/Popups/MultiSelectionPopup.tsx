import { Button, Tooltip } from '@cherrystudio/ui'
import { CopyIcon, DeleteIcon } from '@renderer/components/Icons'
import { useChatContext } from '@renderer/hooks/useChatContext'
import type { Topic } from '@renderer/types'
import { Save, X } from 'lucide-react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface Props {
  topic: Topic
}

const MultiSelectActionPopup: FC<Props> = ({ topic }) => {
  const { t } = useTranslation()
  const { toggleMultiSelectMode, selectedMessageIds, isMultiSelectMode, handleMultiSelectAction } =
    useChatContext(topic)

  const handleAction = (action: string) => {
    handleMultiSelectAction(action, selectedMessageIds)
  }

  const handleClose = () => {
    toggleMultiSelectMode(false)
  }

  if (!isMultiSelectMode) return null

  // TODO: 视情况调整
  // const isActionDisabled = selectedMessages.some((msg) => msg.role === 'user')
  const isActionDisabled = false

  return (
    <Container>
      <ActionBar>
        <SelectionCount>{t('common.selectedMessages', { count: selectedMessageIds.length })}</SelectionCount>
        <ActionButtons>
          <Tooltip content={t('common.save')}>
            <Button
              radius="full"
              variant="light"
              startContent={<Save size={16} />}
              isDisabled={isActionDisabled}
              onPress={() => handleAction('save')}
              isIconOnly
            />
          </Tooltip>
          <Tooltip content={t('common.copy')}>
            <Button
              radius="full"
              variant="light"
              startContent={<CopyIcon size={16} />}
              isDisabled={isActionDisabled}
              onPress={() => handleAction('copy')}
              isIconOnly
            />
          </Tooltip>
          <Tooltip content={t('common.delete')}>
            <Button
              radius="full"
              color="danger"
              variant="light"
              startContent={<DeleteIcon size={16} className="lucide-custom" />}
              onPress={() => handleAction('delete')}
              isIconOnly
            />
          </Tooltip>
        </ActionButtons>
        <Tooltip content={t('chat.navigation.close')}>
          <Button radius="full" variant="light" startContent={<X size={16} />} onPress={handleClose} isIconOnly />
        </Tooltip>
      </ActionBar>
    </Container>
  )
}

const Container = styled.div`
  position: fixed;
  inset: auto 0 0 0;
  z-index: 1000;
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 16px;
`

const ActionBar = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  background-color: var(--color-background);
  padding: 4px 4px;
  border-radius: 99px;
  box-shadow: 0 2px 8px 0 rgb(128 128 128 / 20%);
  border: 0.5px solid var(--color-border);
  gap: 16px;
`

const ActionButtons = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`

const SelectionCount = styled.div`
  color: var(--color-text-2);
  font-size: 14px;
  padding-left: 8px;
  flex-shrink: 0;
`

export default MultiSelectActionPopup
