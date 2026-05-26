import { ActionIconButton } from '@renderer/components/Buttons'
import { Tooltip } from 'antd'
import { Code2 } from 'lucide-react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  onClick: () => void
}

const CodeEditorButton: FC<Props> = ({ onClick }) => {
  const { t } = useTranslation()

  return (
    <Tooltip placement="top" title={t('chat.input.code_editor.title')} mouseLeaveDelay={0} arrow>
      <ActionIconButton onClick={onClick} aria-label={t('chat.input.code_editor.title')}>
        <Code2 size={18} />
      </ActionIconButton>
    </Tooltip>
  )
}

export default CodeEditorButton
