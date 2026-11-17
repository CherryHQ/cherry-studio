import { ChevronsUpDown, FileText, Languages } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { EmptyStateScene, SceneBar, ScenePanel, SceneSlot } from '@cherrystudio/ui'

const SOURCE_LINES = ['w-4/5', 'w-11/12', 'w-3/4', 'w-5/6', 'w-1/2', 'w-11/12', 'w-4/5', 'w-2/3']

/** A PDF waiting to be translated: the source page beside an empty target page, the target language marked. */
export function PdfReadyEmptyScene() {
  const { t } = useTranslation()
  return (
    <EmptyStateScene
      accent={1}
      sprites={[
        { x: 280, y: 3, color: 6, shape: 'corner', tilt: 10 },
        { x: 4, y: 96, color: 3, shape: 'checker', tilt: -12 },
        { x: 292, y: 150, color: 1, shape: 'ring', tilt: 8 }
      ]}>
      <ScenePanel className="absolute top-[13px] left-[21px] h-[220px] w-[270px]">
        <div className="flex h-[34px] shrink-0 items-center gap-[6px] border-b border-border-subtle px-[12px]">
          <FileText size={11} strokeWidth={1.8} className="shrink-0 text-foreground" />
          <SceneBar className="w-[52px] bg-muted-foreground opacity-50" />
          <SceneSlot accent className="ml-auto h-[17px] gap-[4px] border-solid px-[7px] text-[7.3px] font-semibold">
            <span className="truncate">{t('translate.target_language')}</span>
            <ChevronsUpDown size={8} strokeWidth={2.2} className="shrink-0" />
          </SceneSlot>
        </div>
        <div className="flex flex-1 gap-[10px] p-[12px]">
          <div className="flex flex-1 flex-col gap-[5px] rounded-[5px] border border-border-subtle bg-card p-[9px]">
            <SceneBar className="mb-[3px] h-[5px] w-1/2" />
            {SOURCE_LINES.map((width, index) => (
              <SceneBar key={index} className={width} />
            ))}
          </div>
          <SceneSlot className="flex-1 justify-center rounded-[5px]">
            <Languages size={18} strokeWidth={1.4} className="text-foreground-disabled" />
          </SceneSlot>
        </div>
      </ScenePanel>
    </EmptyStateScene>
  )
}
