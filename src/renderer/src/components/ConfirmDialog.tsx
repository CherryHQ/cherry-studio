import { Button } from '@heroui/react'
import { CheckIcon, XIcon } from 'lucide-react'
import { FC } from 'react'
import { createPortal } from 'react-dom'

interface Props {
  x: number
  y: number
  message: string
  onConfirm: () => void
  onCancel: () => void
}

const ConfirmDialog: FC<Props> = ({ x, y, message, onConfirm, onCancel }) => {
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
        <div className="flex min-w-[160px] items-center rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] p-3 shadow-[0_4px_12px_rgba(0,0,0,0.15)]">
          <div className="mr-2 text-sm leading-[1.4]">{message}</div>
          <div className="flex justify-center gap-2">
            <Button onPress={onCancel} radius="full" className="h-6 w-6 min-w-0 p-1" color="danger">
              <XIcon className="text-danger-foreground" size={16} />
            </Button>
            <Button onPress={onConfirm} radius="full" className="h-6 w-6 min-w-0 p-1" color="success">
              <CheckIcon className="text-success-foreground" size={16} />
            </Button>
          </div>
        </div>
      </div>
    </>,
    document.body
  )
}

export default ConfirmDialog
