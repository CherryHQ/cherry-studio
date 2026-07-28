import { memo } from 'react'
import { useTranslation } from 'react-i18next'

interface DividerProps {
  enabledCount: number
  maxEnabled: number
}

const ActionsListDivider = memo(({ enabledCount, maxEnabled }: DividerProps) => {
  const { t } = useTranslation()

  return (
    <div className="my-4 flex items-center justify-center text-foreground-muted text-xs">
      <div className="h-0.5 flex-1 bg-border" />
      <span className="mx-4">
        {t('selection.settings.actions.drag_hint', { enabled: enabledCount, max: maxEnabled })}
      </span>
      <div className="h-0.5 flex-1 bg-border" />
    </div>
  )
})

export default ActionsListDivider
