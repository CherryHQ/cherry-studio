import { Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { EmptyStateScene, SceneBar, SceneButton, SceneInput, ScenePanel, SceneSlot } from '@cherrystudio/ui'

/** Recall test before a query: the focused query field and empty result rows with their score slots. */
export function RecallEmptyScene() {
  const { t } = useTranslation()
  return (
    <EmptyStateScene
      accent={5}
      sprites={[
        { x: 280, y: 3, color: 2, shape: 'corner', tilt: 10 },
        { x: 4, y: 90, color: 8, shape: 'checker', tilt: -12 },
        { x: 292, y: 150, color: 5, shape: 'ring', tilt: 8 }
      ]}>
      <ScenePanel className="absolute top-[13px] left-[21px] h-[220px] w-[270px] gap-[10px] px-[14px] pt-[16px]">
        <div className="flex items-center gap-[7px]">
          <SceneInput focused caret placeholder={t('knowledge.recall.placeholder')} className="h-[21px] flex-1" />
          <SceneButton icon={Search} label={t('common.search')} />
        </div>
        {[0, 1, 2].map((index) => (
          <SceneSlot key={index} className="h-[30px] gap-[10px] rounded-[7px] px-[9px]">
            <span className="flex flex-1 flex-col gap-[5px]">
              <SceneBar className="w-4/5" />
              <SceneBar className="w-1/2" />
            </span>
            <span className="h-[11px] w-[26px] shrink-0 rounded-full border border-dashed border-border-strong" />
          </SceneSlot>
        ))}
      </ScenePanel>
    </EmptyStateScene>
  )
}
