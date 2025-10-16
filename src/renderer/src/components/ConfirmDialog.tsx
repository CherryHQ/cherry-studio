import { Button } from '@heroui/react'
import { FC } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface Props {
  x: number
  y: number
  message: string
  onConfirm: () => void
  onCancel: () => void
}

const ConfirmDialog: FC<Props> = ({ x, y, message, onConfirm, onCancel }) => {
  const { t } = useTranslation()

  if (typeof document === 'undefined') {
    return null
  }

  return createPortal(
    <>
      <Overlay onClick={onCancel} />
      <DialogContainer
        style={{
          left: `${x}px`,
          top: `${y}px`
        }}>
        <DialogContent>
          <Message>{message}</Message>
          <ButtonGroup>
            <Button size="sm" variant="flat" onPress={onCancel} className="min-w-[60px]">
              {t('common.cancel')}
            </Button>
            <Button size="sm" color="primary" onPress={onConfirm} className="min-w-[60px]">
              {t('common.confirm')}
            </Button>
          </ButtonGroup>
        </DialogContent>
      </DialogContainer>
    </>,
    document.body
  )
}

const Overlay = styled.div`
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 99998;
  background: transparent;
`

const DialogContainer = styled.div`
  position: fixed;
  z-index: 99999;
  transform: translate(-50%, -100%);
  margin-top: -8px;
`

const DialogContent = styled.div`
  background: var(--color-background);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 12px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  min-width: 160px;
  max-width: 200px;
`

const Message = styled.div`
  font-size: 13px;
  margin-bottom: 10px;
  text-align: center;
  color: var(--color-text);
  line-height: 1.4;
`

const ButtonGroup = styled.div`
  display: flex;
  gap: 8px;
  justify-content: center;
`

export default ConfirmDialog
