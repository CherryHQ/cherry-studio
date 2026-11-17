import { GitBranch, MessageSquare } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { EmptyStateScene, SceneBar, SceneHeader, ScenePanel, SceneSlot } from '@cherrystudio/ui'

/** No message flow: an empty graph whose first node is the accent slot. */
export function TopicMessageFlowEmptyScene() {
  const { t } = useTranslation()
  return (
    <EmptyStateScene
      size="panel"
      accent={6}
      sprites={[
        { x: 232, y: 3, color: 3, shape: 'checker', tilt: 10 },
        { x: 4, y: 74, color: 1, shape: 'cross', tilt: -12 },
        { x: 240, y: 120, color: 6, shape: 'ring', tilt: 8 }
      ]}>
      <ScenePanel className="absolute top-[10px] left-[18px] h-[190px] w-[224px]">
        <SceneHeader icon={GitBranch} title={t('chat.message.flow.title')} />
        <div className="relative flex-1">
          <svg className="absolute inset-0 size-full fill-none stroke-border-strong" aria-hidden="true">
            <path d="M112 40 C112 60 52 58 52 78 M112 40 C112 60 172 58 172 78" strokeDasharray="3 3" strokeWidth="1" />
          </svg>
          <SceneSlot accent className="absolute top-[12px] left-[70px] h-[28px] w-[84px] gap-[5px] bg-card px-[8px]">
            <MessageSquare size={10} strokeWidth={2} className="shrink-0" />
            <SceneBar className="w-[42px] bg-current opacity-40" />
          </SceneSlot>
          <SceneSlot className="absolute top-[78px] left-[16px] h-[24px] w-[72px] bg-card px-[8px]">
            <SceneBar className="w-[40px]" />
          </SceneSlot>
          <SceneSlot className="absolute top-[78px] left-[136px] h-[24px] w-[72px] bg-card px-[8px]">
            <SceneBar className="w-[40px]" />
          </SceneSlot>
        </div>
      </ScenePanel>
    </EmptyStateScene>
  )
}
