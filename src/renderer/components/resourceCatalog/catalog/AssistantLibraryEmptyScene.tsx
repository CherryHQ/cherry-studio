import { useTranslation } from 'react-i18next'

import { EmptyStateScene, SceneBar, ScenePanel, SceneRow, SceneSlot } from '@cherrystudio/ui'

const CATEGORY_WIDTHS = ['w-[30px]', 'w-[38px]', 'w-[26px]', 'w-[34px]']

/** A category without presets: the category list and an empty preset grid. */
export function AssistantLibraryEmptyScene() {
  const { t } = useTranslation()
  return (
    <EmptyStateScene
      size="panel"
      accent={3}
      sprites={[
        { x: 232, y: 3, color: 2, shape: 'ring', tilt: 10 },
        { x: 4, y: 80, color: 4, shape: 'corner', tilt: -12 },
        { x: 240, y: 120, color: 3, shape: 'checker', tilt: 8 }
      ]}>
      <ScenePanel className="absolute top-[10px] left-[18px] h-[190px] w-[224px] flex-row">
        <div className="flex w-[78px] shrink-0 flex-col gap-[3px] border-r border-border-subtle p-[6px]">
          <SceneRow selected label={t('common.all')} />
          {CATEGORY_WIDTHS.map((width) => (
            <SceneRow key={width} label={<SceneBar className={width} />} />
          ))}
        </div>
        <div className="grid flex-1 grid-cols-2 content-start gap-[8px] p-[10px]">
          {[0, 1, 2, 3].map((index) => (
            <SceneSlot key={index} className="h-[56px] flex-col items-start gap-[6px] rounded-[8px] p-[7px]">
              <span className="size-[9px] rounded-full border border-dashed border-border-strong" />
              <SceneBar className="w-3/4" />
            </SceneSlot>
          ))}
        </div>
      </ScenePanel>
    </EmptyStateScene>
  )
}
