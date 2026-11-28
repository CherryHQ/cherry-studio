import { Copy, X } from 'lucide-react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

import { Alert, Button } from '@cherrystudio/ui'

interface OpenClawStartupErrorAlertProps {
  startupError: { operation: string; message: string }
  onCopy: () => void
  onDismiss: () => void
}

export const OpenClawStartupErrorAlert: FC<OpenClawStartupErrorAlertProps> = ({ startupError, onCopy, onDismiss }) => {
  const { t } = useTranslation()
  return (
    <Alert
      type="error"
      showIcon
      message={t('code.launch.error')}
      description={<pre className="selectable whitespace-pre-wrap break-words font-sans">{startupError.message}</pre>}
      action={
        <div className="flex items-center gap-1">
          <Button type="button" variant="outline" size="sm" onClick={onCopy}>
            <Copy size={12} />
            {t('common.copy')}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onDismiss}
            aria-label={t('common.close')}
            title={t('common.close')}>
            <X size={14} />
          </Button>
        </div>
      }
    />
  )
}
