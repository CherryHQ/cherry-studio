import { NotebookPen, Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { EmptyStateScene, SceneBar, SceneButton, SceneInput, ScenePanel, SceneSlot } from '@cherrystudio/ui'

/** No notes to import: an empty note picker that points to the Notes app. */
export function NoteImportEmptyScene() {
  const { t } = useTranslation()
  return (
    <EmptyStateScene
      size="panel"
      accent={7}
      sprites={[
        { x: 232, y: 3, color: 1, shape: 'cross', tilt: 10 },
        { x: 4, y: 76, color: 3, shape: 'corner', tilt: -12 },
        { x: 240, y: 120, color: 7, shape: 'checker', tilt: 8 }
      ]}>
      <ScenePanel className="absolute top-[10px] left-[18px] h-[190px] w-[224px] gap-[7px] px-[12px] pt-[12px]">
        <div className="flex items-center gap-[6px]">
          <SceneInput icon={Search} value={<SceneBar className="w-[60px]" />} className="flex-1" />
          <SceneButton accent icon={NotebookPen} label={t('notes.title')} />
        </div>
        {[0, 1, 2, 3].map((index) => (
          <div key={index} className="flex items-center gap-[6px]">
            <span className="size-[9px] shrink-0 rounded-[2.5px] border border-border-strong" />
            <SceneSlot className="h-[16px] flex-1 px-[7px]">
              <SceneBar className="w-2/5" />
            </SceneSlot>
          </div>
        ))}
      </ScenePanel>
    </EmptyStateScene>
  )
}
