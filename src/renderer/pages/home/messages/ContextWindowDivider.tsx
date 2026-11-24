import { useTranslation } from 'react-i18next'

export function ContextWindowDivider({ limit }: { limit: number }) {
  const { t } = useTranslation()
  return (
    <div className="context-window-divider mx-5 my-4 flex items-center gap-2 text-sm text-foreground-tertiary">
      <hr className="flex-1 border-dashed border-border" />
      <span>{t('chat.message.context_window_excluded', { limit })}</span>
      <hr className="flex-1 border-dashed border-border" />
    </div>
  )
}
