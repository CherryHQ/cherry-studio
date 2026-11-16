import { Folder, Upload } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import {
  EmptyStateScene,
  SceneButton,
  SceneGhostRow,
  SceneHeader,
  ScenePanel,
  SceneSlot,
  SceneTabs
} from '@cherrystudio/ui'

/** No files: the files table with an accent drop row where the first upload lands. */
export function FilesEmptyScene() {
  const { t } = useTranslation()
  return (
    <EmptyStateScene
      accent={1}
      sprites={[
        { x: 280, y: 3, color: 4, shape: 'ring', tilt: 10 },
        { x: 5, y: 92, color: 6, shape: 'corner', tilt: -12 },
        { x: 292, y: 150, color: 1, shape: 'checker', tilt: 8 }
      ]}>
      <ScenePanel className="absolute top-[13px] left-[21px] h-[220px] w-[270px]">
        <SceneHeader
          icon={Folder}
          title={t('files.title')}
          trailing={<SceneButton icon={Upload} label={t('files.upload')} />}
        />
        <div className="flex flex-col gap-[7px] px-[10px] pt-[8px]">
          <SceneTabs items={[t('files.all'), t('files.image'), t('files.document')]} className="px-[5px]" />
          <div className="flex border-b border-border-subtle px-[5px] pb-[4px] text-[6.8px] text-foreground-tertiary">
            <span className="flex-1 truncate">{t('files.name')}</span>
            <span className="w-[48px] truncate">{t('files.size')}</span>
            <span className="w-[56px] truncate">{t('files.modified_at')}</span>
          </div>
          <SceneSlot accent className="h-[34px] justify-center gap-[5px] text-[8px] font-semibold">
            <Upload size={10} strokeWidth={2} className="shrink-0" />
            <span className="truncate">{t('files.drag_upload')}</span>
          </SceneSlot>
          <SceneGhostRow lead />
          <SceneGhostRow lead />
        </div>
      </ScenePanel>
    </EmptyStateScene>
  )
}
