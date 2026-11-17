import { DatabaseBackup } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { EmptyStateScene, SceneBar, SceneHeader, ScenePanel, SceneSlot } from '@cherrystudio/ui'

const COLUMNS = [
  { key: 'settings.data.local.backup.manager.columns.fileName', className: 'flex-1' },
  { key: 'settings.data.local.backup.manager.columns.size', className: 'w-[40px]' },
  { key: 'settings.data.local.backup.manager.columns.modifiedTime', className: 'w-[56px]' }
]

/** No backups: the backup table with its columns and an accent row where the first backup lands. */
export function BackupEmptyScene() {
  const { t } = useTranslation()
  return (
    <EmptyStateScene
      size="panel"
      accent={4}
      sprites={[
        { x: 232, y: 3, color: 6, shape: 'checker', tilt: 10 },
        { x: 4, y: 86, color: 1, shape: 'corner', tilt: -12 },
        { x: 240, y: 120, color: 4, shape: 'ring', tilt: 8 }
      ]}>
      <ScenePanel className="absolute top-[10px] left-[18px] h-[190px] w-[224px]">
        <SceneHeader icon={DatabaseBackup} title={t('settings.data.local.backup.manager.title')} />
        <div className="mx-[12px] mt-[9px] flex gap-[6px] border-b border-border-subtle pb-[4px] text-[6.8px] text-foreground-tertiary">
          {COLUMNS.map(({ key, className }) => (
            <span key={key} className={`truncate ${className}`}>
              {t(key)}
            </span>
          ))}
        </div>
        <div className="flex flex-col gap-[6px] px-[10px] pt-[7px]">
          <SceneSlot accent className="h-[18px] gap-[6px] px-[7px]">
            <SceneBar className="w-1/3 bg-current opacity-40" />
          </SceneSlot>
          {[0, 1, 2].map((index) => (
            <SceneSlot key={index} className="h-[18px] gap-[6px] px-[7px]">
              <SceneBar className="flex-1" />
              <SceneBar className="w-[26px]" />
              <SceneBar className="w-[40px]" />
            </SceneSlot>
          ))}
        </div>
      </ScenePanel>
    </EmptyStateScene>
  )
}
