import { useTranslation } from 'react-i18next'

import { Separator } from '@cherrystudio/ui/components/primitives/separator'

export function ContextWindowDivider({ limit }: { limit: number }) {
  const { t } = useTranslation()
  return (
    <div className="context-window-divider mx-5 my-4 flex items-center gap-2 text-sm text-foreground-tertiary">
      <Separator className="flex-1 border-t border-dashed border-border bg-transparent" />
      <span>{t('chat.message.context_window_excluded', { limit })}</span>
      <Separator className="flex-1 border-t border-dashed border-border bg-transparent" />
    </div>
  )
}
