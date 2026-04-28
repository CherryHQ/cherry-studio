import { Button } from '@cherrystudio/ui'
import { t } from 'i18next'
import { TriangleAlert, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

const LOCALSTORAGE_KEY = 'openai_alert_closed'

interface Props {
  message?: string
  /** Disambiguate when multiple alerts use different localStorage slots. */
  storageKey?: string
}

const OpenAIAlert = ({ message = t('settings.provider.openai.alert'), storageKey = LOCALSTORAGE_KEY }: Props) => {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const closed = localStorage.getItem(storageKey)
    setVisible(!closed)
  }, [storageKey])

  const dismiss = useCallback(() => {
    localStorage.setItem(storageKey, '1')
    setVisible(false)
  }, [storageKey])

  if (!visible) return null

  return (
    <div
      className="mx-0 my-[5px] flex w-full items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-foreground text-sm"
      role="alert">
      <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
      <p className="min-w-0 flex-1">{message}</p>
      <Button type="button" variant="ghost" size="icon-sm" className="shrink-0" onClick={dismiss}>
        <X className="size-4" />
      </Button>
    </div>
  )
}

export default OpenAIAlert
