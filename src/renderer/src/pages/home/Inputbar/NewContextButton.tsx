import { useShortcut, useShortcutDisplay } from '@renderer/hooks/useShortcuts'
import { Tooltip } from 'antd'
import { CircleFadingPlus } from 'lucide-react'
import { FC } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface Props {
  onNewContext: () => void
  ToolbarButton: any
}

const NewContextButton: FC<Props> = ({ onNewContext, ToolbarButton }) => {
  const newContextShortcut = useShortcutDisplay('toggle_new_context')
  const { t } = useTranslation()

  useShortcut('toggle_new_context', onNewContext)

  return (
    <Container>
      <Tooltip placement="top" title={t('chat.input.new.context', { Command: newContextShortcut })} arrow>
        <ToolbarButton type="text" onClick={onNewContext}>
          <CircleFadingPlus size={18} />
        </ToolbarButton>
      </Tooltip>
    </Container>
  )
}

const Container = styled.div`
  @media (max-width: 800px) {
    display: none;
  }
`

export default NewContextButton
