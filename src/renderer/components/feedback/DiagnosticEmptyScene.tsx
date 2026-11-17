import { Stethoscope } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { EmptyStateScene, SceneGhostRow, SceneHeader, ScenePanel, SceneSlot } from '@cherrystudio/ui'

/** No diagnostic reports: a flat pulse with the accent marking where a check would register, over empty report rows. */
export function DiagnosticEmptyScene() {
  const { t } = useTranslation()
  return (
    <EmptyStateScene
      size="panel"
      accent={8}
      sprites={[
        { x: 232, y: 3, color: 3, shape: 'corner', tilt: 10 },
        { x: 4, y: 84, color: 5, shape: 'checker', tilt: -12 },
        { x: 240, y: 120, color: 8, shape: 'ring', tilt: 8 }
      ]}>
      <ScenePanel className="absolute top-[10px] left-[18px] h-[190px] w-[224px]">
        <SceneHeader icon={Stethoscope} title={t('settings.about.feedback.history.title')} />
        <div className="flex flex-col gap-[7px] px-[10px] pt-[10px]">
          <div className="relative h-[44px] rounded-[6px] border border-border-subtle bg-muted">
            <svg className="absolute inset-0 size-full fill-none stroke-foreground-tertiary" aria-hidden="true">
              <path d="M8 22 H82 L88 13 L95 31 L101 22 H196" strokeWidth="1" strokeLinejoin="round" />
            </svg>
            <SceneSlot accent className="absolute top-[17px] left-[93px] size-[10px] rounded-full border-solid" />
          </div>
          <SceneGhostRow lead />
          <SceneGhostRow lead />
        </div>
      </ScenePanel>
    </EmptyStateScene>
  )
}
