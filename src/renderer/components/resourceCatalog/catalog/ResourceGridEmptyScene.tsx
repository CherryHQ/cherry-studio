import { Blocks, Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { EmptyStateScene, SceneButton, SceneHeader, ScenePanel, SceneSlot, SceneTabs } from '@cherrystudio/ui'

const GHOST_CARDS = 6

/** Empty library: its type tabs, an accent add button, and a grid of empty card outlines. */
export function ResourceGridEmptyScene() {
  const { t } = useTranslation()
  return (
    <EmptyStateScene
      accent={6}
      sprites={[
        { x: 280, y: 3, color: 3, shape: 'checker', tilt: 10 },
        { x: 4, y: 96, color: 1, shape: 'cross', tilt: -12 },
        { x: 292, y: 150, color: 6, shape: 'ring', tilt: 8 }
      ]}>
      <ScenePanel className="absolute top-[13px] left-[21px] h-[220px] w-[270px]">
        <SceneHeader
          icon={Blocks}
          title={t('library.title')}
          trailing={<SceneButton accent icon={Plus} label={t('common.add')} />}
        />
        <SceneTabs
          className="border-b border-border-subtle px-[16px] pt-[8px]"
          items={[
            t('library.type.assistant'),
            t('library.type.agent'),
            t('library.type.prompt'),
            t('library.type.skill')
          ]}
        />
        <div className="grid grid-cols-3 gap-[9px] px-[14px] pt-[11px]">
          {Array.from({ length: GHOST_CARDS }, (_, index) => (
            <SceneSlot key={index} className="h-[50px] flex-col items-start gap-[6px] rounded-[9px] p-[8px]">
              <span className="size-[9px] rounded-full border border-dashed border-border-strong" />
              <span className="block h-[4px] w-3/4 rounded-full bg-border" />
            </SceneSlot>
          ))}
        </div>
      </ScenePanel>
    </EmptyStateScene>
  )
}
