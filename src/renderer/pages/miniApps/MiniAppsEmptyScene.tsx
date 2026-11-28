import { Plus, Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { EmptyStateScene, SceneBar, SceneFloat, SceneInput, ScenePanel, SceneSlot } from '@cherrystudio/ui'

const EMPTY_TILES = 7

/** No mini apps: the launcher grid with an accent add tile and the add-by-URL popover. */
export function MiniAppsEmptyScene() {
  const { t } = useTranslation()
  return (
    <EmptyStateScene
      accent={3}
      sprites={[
        { x: 278, y: 3, color: 6, shape: 'corner', tilt: 10 },
        { x: 5, y: 104, color: 8, shape: 'ring', tilt: -12 },
        { x: 294, y: 151, color: 3, shape: 'checker', tilt: 8 }
      ]}>
      <ScenePanel className="absolute top-[13px] left-[21px] h-[220px] w-[270px]">
        <div className="flex h-[34px] shrink-0 items-center px-[16px]">
          <span className="truncate text-[9px] font-semibold text-foreground">{t('miniApp.title')}</span>
          <SceneInput icon={Search} placeholder={t('common.search')} className="ml-auto w-[80px]" />
        </div>
        <div className="grid grid-cols-4 gap-x-[16px] gap-y-[12px] px-[23px] pt-[6px]">
          <div className="flex flex-col items-center gap-[5px]">
            <SceneSlot accent className="size-[44px] justify-center rounded-[13px]">
              <Plus size={15} strokeWidth={2} />
            </SceneSlot>
            <span className="truncate text-[7px] text-muted-foreground">{t('common.add')}</span>
          </div>
          {Array.from({ length: EMPTY_TILES }, (_, index) => (
            <div key={index} className="flex flex-col items-center gap-[5px]">
              <SceneSlot className="size-[44px] rounded-[13px]" />
              <SceneBar className="mt-[3px] w-[24px]" />
            </div>
          ))}
        </div>
      </ScenePanel>
      <SceneFloat className="top-[83px] left-[83px]">
        <ScenePanel className="w-[153px] gap-[5px] rounded-[10px] px-[10px] py-[9px]">
          <span className="truncate text-[7.8px] font-semibold text-foreground">{t('miniApp.add.title')}</span>
          <SceneInput value="https://" caret />
        </ScenePanel>
      </SceneFloat>
    </EmptyStateScene>
  )
}
