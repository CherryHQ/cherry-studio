import { History, Languages } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { EmptyStateScene, SceneBar, SceneChip, SceneHeader, ScenePanel, SceneSlot } from '@cherrystudio/ui'

/** No translations yet: the history list with only empty entries, each with its language-pair slot. */
export function TranslateHistoryEmptyScene() {
  const { t } = useTranslation()
  return (
    <EmptyStateScene
      size="panel"
      accent={6}
      sprites={[
        { x: 232, y: 3, color: 1, shape: 'ring', tilt: 10 },
        { x: 4, y: 84, color: 3, shape: 'corner', tilt: -12 },
        { x: 240, y: 120, color: 6, shape: 'checker', tilt: 8 }
      ]}>
      <ScenePanel className="absolute top-[10px] left-[18px] h-[190px] w-[224px]">
        <SceneHeader
          icon={History}
          title={t('translate.history.title')}
          trailing={
            <SceneChip accent icon={Languages} label={<SceneBar className="w-[24px] bg-current opacity-50" />} />
          }
        />
        <div className="flex flex-col gap-[7px] px-[10px] pt-[9px]">
          {[0, 1, 2, 3].map((index) => (
            <SceneSlot key={index} className="h-[24px] gap-[7px] rounded-[6px] px-[7px]">
              <span className="h-[11px] w-[34px] shrink-0 rounded-full border border-dashed border-border-strong" />
              <SceneBar className="w-1/2" />
            </SceneSlot>
          ))}
        </div>
      </ScenePanel>
    </EmptyStateScene>
  )
}
