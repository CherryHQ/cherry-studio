import { useChatContext } from '@renderer/pages/home/Messages/ChatContext'
import { Button, Tooltip } from 'antd'
import { Copy, Save, Trash, X } from 'lucide-react'
import { FC } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

const MultiSelectActionPopup: FC = () => {
  const { t } = useTranslation()
  const { toggleMultiSelectMode, selectedMessageIds, isMultiSelectMode, handleMultiSelectAction } = useChatContext()

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
          <Tooltip title={t('common.save')}>
            <ActionButton icon={<Save size={16} />} disabled={isActionDisabled} onClick={() => handleAction('save')} />
          </Tooltip>
          <Tooltip title={t('common.copy')}>
            <ActionButton icon={<Copy size={16} />} disabled={isActionDisabled} onClick={() => handleAction('copy')} />
          </Tooltip>
          <Tooltip title={t('common.delete')}>
            <ActionButton danger icon={<Trash size={16} />} onClick={() => handleAction('delete')} />
          </Tooltip>
        </ActionButtons>
        <Tooltip title={t('chat.navigation.close')}>
          <ActionButton icon={<X size={16} />} onClick={handleClose} />
        </Tooltip>
      </ActionBar>
    </Container>
  )
}

const Container = styled.div`
  position: absolute;
  bottom: 0;
  left: 0;
  width: 100%;
  padding: 36px 20px;
  background-color: var(--color-background);
  border-top: 1px solid var(--color-border);
  z-index: 10;
`

const ActionBar = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
`

const ActionButtons = styled.div`
  display: flex;
  gap: 16px;
`

const ActionButton = styled(Button)`
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 8px 16px;
  border-radius: 50%;
  .anticon {
    font-size: 16px;
  }
  &:hover {
    background-color: var(--color-background-mute);
  }
  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`

const SelectionCount = styled.div`
  margin-right: 15px;
  color: var(--color-text-2);
  font-size: 14px;
`

export default MultiSelectActionPopup
