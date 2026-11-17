import { Activity } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { EmptyStateScene, SceneHeader, ScenePanel, SceneSlot, SceneToggle } from '@cherrystudio/ui'

const TICKS = ['0', '120', '240']
const SPANS = [
  { left: 0, width: 168 },
  { left: 16, width: 96 },
  { left: 44, width: 78 },
  { left: 92, width: 60 },
  { left: 60, width: 48 }
]

/** No trace: the call-chain waterfall with only empty span outlines, recording switched off. */
export function TraceEmptyScene() {
  const { t } = useTranslation()
  return (
    <EmptyStateScene
      size="panel"
      accent={8}
      sprites={[
        { x: 232, y: 3, color: 2, shape: 'corner', tilt: 10 },
        { x: 4, y: 88, color: 5, shape: 'checker', tilt: -12 },
        { x: 240, y: 122, color: 8, shape: 'cross', tilt: 8 }
      ]}>
      <ScenePanel className="absolute top-[10px] left-[18px] h-[190px] w-[224px]">
        <SceneHeader icon={Activity} title={t('trace.label')} trailing={<SceneToggle accent />} />
        <div className="relative flex-1 px-[16px] pt-[9px]">
          <div className="flex justify-between text-[6.5px] text-foreground-tertiary">
            {TICKS.map((tick) => (
              <span key={tick}>{tick}</span>
            ))}
          </div>
          <div className="relative mt-[6px] flex flex-col gap-[7px]">
            {SPANS.map(({ left, width }) => (
              <div key={`${left}-${width}`} style={{ marginLeft: left, width }}>
                <SceneSlot className="h-[10px] rounded-[3px]" />
              </div>
            ))}
          </div>
        </div>
      </ScenePanel>
    </EmptyStateScene>
  )
}
