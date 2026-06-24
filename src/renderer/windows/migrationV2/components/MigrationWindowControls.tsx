import { Button } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { isMac } from '@renderer/config/constant'
import { MigrationIpcChannels } from '@shared/data/migration/v2/types'
import { Minus, X } from 'lucide-react'
import type React from 'react'
import { useTranslation } from 'react-i18next'

const controlButtonClass =
  'h-full w-12 rounded-none text-foreground-secondary shadow-none transition-[background,color] duration-150 hover:bg-accent hover:text-foreground [&_svg]:pointer-events-none'

/**
 * Custom minimize/close controls for the frameless migration window on Windows/Linux.
 * macOS renders real native traffic lights instead, so this returns null there.
 */
export const MigrationWindowControls: React.FC = () => {
  const { t } = useTranslation()

  if (isMac) {
    return null
  }

  const handleMinimize = () => {
    void window.electron.ipcRenderer.invoke(MigrationIpcChannels.Minimize)
  }

  const handleClose = () => {
    void window.electron.ipcRenderer.invoke(MigrationIpcChannels.CloseWindow)
  }

  return (
    <div className="absolute top-0 right-0 flex h-full items-stretch [-webkit-app-region:no-drag]">
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className={controlButtonClass}
        onClick={handleMinimize}
        aria-label={t('migration.window.minimize')}>
        <Minus size={16} />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className={cn(controlButtonClass, 'hover:bg-destructive hover:text-white')}
        onClick={handleClose}
        aria-label={t('migration.window.close')}>
        <X size={16} />
      </Button>
    </div>
  )
}
