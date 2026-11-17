import { Search, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { EmptyStateScene, SceneBar, SceneChip, SceneInput, ScenePanel, SceneSlot } from '@cherrystudio/ui'

const GHOST_CARDS = 6

/** A search with no matches: the query in the search field, an accent clear button, and empty results. */
export function MarketplaceEmptyScene() {
  const { t } = useTranslation()
  return (
    <EmptyStateScene
      accent={4}
      sprites={[
        { x: 280, y: 3, color: 1, shape: 'ring', tilt: 10 },
        { x: 4, y: 104, color: 5, shape: 'corner', tilt: -12 },
        { x: 292, y: 150, color: 4, shape: 'checker', tilt: 8 }
      ]}>
      <ScenePanel className="absolute top-[13px] left-[21px] h-[220px] w-[270px] gap-[9px] px-[14px] pt-[14px]">
        <div className="relative">
          <SceneInput
            icon={Search}
            value={<SceneBar className="w-[64px] bg-muted-foreground" />}
            className="h-[20px] pr-[24px]"
          />
          <SceneSlot
            accent
            className="absolute top-[4px] right-[5px] size-[12px] justify-center rounded-full border-solid">
            <X size={7} strokeWidth={2.6} />
          </SceneSlot>
        </div>
        <div className="flex gap-[5px]">
          <SceneChip label={t('common.all')} />
          <SceneChip label={t('library.type.assistant')} />
          <SceneChip label={t('library.type.agent')} />
          <SceneChip label={t('library.type.skill')} />
        </div>
        <div className="grid grid-cols-3 gap-[9px] border-t border-border-subtle pt-[10px]">
          {Array.from({ length: GHOST_CARDS }, (_, index) => (
            <SceneSlot key={index} className="h-[46px] flex-col items-start gap-[6px] rounded-[9px] p-[8px]">
              <span className="size-[9px] rounded-full border border-dashed border-border-strong" />
              <SceneBar className="w-3/4" />
            </SceneSlot>
          ))}
        </div>
      </ScenePanel>
    </EmptyStateScene>
  )
}
