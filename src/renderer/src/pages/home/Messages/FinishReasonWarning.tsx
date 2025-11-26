import type { FinishReason } from 'ai'
import { Alert as AntdAlert, Button } from 'antd'
import { Play } from 'lucide-react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface Props {
  finishReason: FinishReason
  onContinue?: () => void
  onDismiss?: () => void
}

/**
 * Displays a warning banner when message generation was truncated or filtered
 * Only shows for non-normal finish reasons (not 'stop' or 'tool-calls')
 */
const FinishReasonWarning: React.FC<Props> = ({ finishReason, onContinue, onDismiss }) => {
  const { t } = useTranslation()

  // Don't show warning for normal finish reasons
  if (finishReason === 'stop' || finishReason === 'tool-calls') {
    return null
  }

  const getWarningMessage = () => {
    const i18nKey = `message.warning.finish_reason.${finishReason}`
    return t(i18nKey)
  }

  // Only show continue button for 'length' reason (max tokens reached)
  const showContinueButton = finishReason === 'length' && onContinue

  return (
    <Alert
      message={getWarningMessage()}
      type="warning"
      showIcon
      closable={!!onDismiss}
      onClose={onDismiss}
      action={
        showContinueButton && (
          <Button
            size="small"
            type="text"
            icon={<Play size={14} />}
            onClick={onContinue}
            style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            {t('message.warning.finish_reason.continue')}
          </Button>
        )
      }
    />
  )
}

const Alert = styled(AntdAlert)`
  margin: 0.5rem 0 !important;
  padding: 8px 12px;
  font-size: 12px;
  align-items: center;
`

export default React.memo(FinishReasonWarning)
