import { Button } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { SlidersHorizontal } from 'lucide-react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

import { paintingWorkspaceClasses } from '../PaintingWorkspacePrimitives'

interface PaintingFloatingToolbarProps {
  isParametersOpen: boolean
  onToggleParameters: () => void
}

const PaintingFloatingToolbar: FC<PaintingFloatingToolbarProps> = ({ isParametersOpen, onToggleParameters }) => {
  const { t } = useTranslation()

  return (
    <div className={paintingWorkspaceClasses.toolbarWrap}>
      <div className={paintingWorkspaceClasses.toolbarRail}>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          title={t('common.parameter')}
          className={cn(
            paintingWorkspaceClasses.toolbarButton,
            isParametersOpen && paintingWorkspaceClasses.toolbarButtonActive
          )}
          onClick={onToggleParameters}>
          <SlidersHorizontal className="size-4" />
        </Button>
      </div>
    </div>
  )
}

export default PaintingFloatingToolbar
