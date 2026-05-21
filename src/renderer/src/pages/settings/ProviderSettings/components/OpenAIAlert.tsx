import { Button } from '@cherrystudio/ui'
import { usePersistCache } from '@data/hooks/useCache'
import { TriangleAlert, X } from 'lucide-react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  message?: string
}

export default function OpenAIAlert({ message }: Props) {
  const { t } = useTranslation()
  const [dismissed, setDismissed] = usePersistCache('settings.provider.openai.alert.dismissed')
  const resolvedMessage = message ?? t('settings.provider.openai.alert')

  const dismiss = useCallback(() => {
    setDismissed(true)
  }, [setDismissed])

  if (dismissed) return null

  return (
    <div
      className="mx-0 my-[5px] flex w-full items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-foreground text-sm"
      role="alert">
      <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
      <p className="min-w-0 flex-1">{resolvedMessage}</p>
      <Button type="button" variant="ghost" size="icon-sm" className="shrink-0" onClick={dismiss}>
        <X className="size-4" />
      </Button>
    </div>
  )
}
