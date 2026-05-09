import { Alert, Button } from '@cherrystudio/ui'
import { t } from 'i18next'
import { X } from 'lucide-react'
import { useEffect, useState } from 'react'

const LOCALSTORAGE_KEY = 'openai_alert_closed'

interface Props {
  message?: string
  key?: string
}

const OpenAIAlert = ({ message = t('settings.provider.openai.alert'), key = LOCALSTORAGE_KEY }: Props) => {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const closed = localStorage.getItem(key)
    setVisible(!closed)
  }, [key])

  if (!visible) return null

  const handleClose = () => {
    localStorage.setItem(LOCALSTORAGE_KEY, '1')
    setVisible(false)
  }

  return (
    <Alert
      style={{ width: '100%', marginTop: 5, marginBottom: 5 }}
      message={message}
      type="warning"
      action={
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="-my-1 size-6 min-h-6 text-[var(--color-warning-base)] shadow-none hover:bg-black/5 dark:hover:bg-white/10"
          aria-label={t('common.close')}
          title={t('common.close')}
          onClick={handleClose}>
          <X size={14} />
        </Button>
      }
    />
  )
}

export default OpenAIAlert
