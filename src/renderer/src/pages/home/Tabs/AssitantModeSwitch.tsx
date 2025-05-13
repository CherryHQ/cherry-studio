import { AlignLeftOutlined, MenuOutlined } from '@ant-design/icons'
import { useAppDispatch } from '@renderer/store'
import { setAssistantTabDefaultMode } from '@renderer/store/settings'
import { Tooltip } from 'antd'
import { FC } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface AssistantsTabProps {
  groupMode: 'assitants' | 'groups'
  setGroupMode: (type: 'assitants' | 'groups') => void
}

const AssitantModeSwitch: FC<AssistantsTabProps> = ({ groupMode, setGroupMode }) => {
  const dispatch = useAppDispatch()
  const { t } = useTranslation()

  return (
    <ModeSwitch>
      <Tooltip title={t('assistants.title')}>
        <IconButton
          active={groupMode === 'assitants'}
          onClick={() => {
            dispatch(setAssistantTabDefaultMode('assitants'))
            setGroupMode('assitants')
          }}>
          <MenuOutlined style={{ fontSize: 16 }} />
        </IconButton>
      </Tooltip>
      <Tooltip title={t(t('assistants.group.title'))}>
        <IconButton
          active={groupMode === 'groups'}
          onClick={() => {
            dispatch(setAssistantTabDefaultMode('groups'))
            setGroupMode('groups')
          }}>
          <AlignLeftOutlined style={{ fontSize: 16 }} />
        </IconButton>
      </Tooltip>
    </ModeSwitch>
  )
}

const ModeSwitch = styled.div`
  margin-bottom: 10px;
  display: flex;
  justify-content: flex-start;
`

const IconButton = styled.div<{ active: boolean }>`
  border: 1px solid var(--color-border);
  cursor: pointer;
  padding: 4px;
  color: ${(props) => (props.active ? 'var(--color-primary)' : 'var(--color-text-2)')};
  background: ${(props) => (props.active ? 'unset' : 'var(--color-background-soft)')};
  &:first-child {
    border-radius: 12px 0 0 12px;
    border-right: none;
  }
  &:last-child {
    border-radius: 0 12px 12px 0;
  }
`

export default AssitantModeSwitch
