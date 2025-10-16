import { Button } from '@heroui/react'
import { FC } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'

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
      <div className="fixed inset-0 z-[99998] bg-transparent" onClick={onCancel} />
      <div
        className="-translate-x-1/2 -translate-y-full fixed z-[99999] mt-[-8px] transform"
        style={{
          left: `${x}px`,
          top: `${y}px`
        }}>
        <div className="min-w-[160px] max-w-[200px] rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] p-3 shadow-[0_4px_12px_rgba(0,0,0,0.15)]">
          <div className="mb-2.5 text-center text-[13px] text-[var(--color-text)] leading-[1.4]">{message}</div>
          <div className="flex justify-center gap-2">
            <Button size="sm" variant="flat" onPress={onCancel} className="min-w-[60px]">
              {t('common.cancel')}
            </Button>
            <Button size="sm" color="primary" onPress={onConfirm} className="min-w-[60px]">
              {t('common.confirm')}
            </Button>
          </div>
        </div>
      </div>
    </>,
    document.body
  )
}

export default ConfirmDialog
