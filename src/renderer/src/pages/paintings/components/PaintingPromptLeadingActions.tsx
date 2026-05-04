import { Button, Tooltip } from '@cherrystudio/ui'
import { SlidersHorizontal } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { PaintingData } from '../model/types/paintingData'
import { paintingClasses } from '../PaintingPrimitives'
import { PaintingModeTabs } from './PaintingModeTabs'

interface PaintingPromptLeadingActionsProps {
  painting: PaintingData
  onPaintingChange: (updates: Partial<PaintingData>) => void
  onToggleParameters: () => void
}

export function PaintingPromptLeadingActions({
  painting,
  onPaintingChange,
  onToggleParameters
}: PaintingPromptLeadingActionsProps) {
  const { t } = useTranslation()

  return (
    <>
      <Tooltip content={t('common.settings')} delay={500}>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className={paintingClasses.promptSettingButton}
          aria-label={t('common.settings')}
          onClick={onToggleParameters}>
          <SlidersHorizontal className="size-3.5" />
        </Button>
      </Tooltip>
      <PaintingModeTabs painting={painting} onPaintingChange={onPaintingChange} />
    </>
  )
}
