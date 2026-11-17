import { Bot, GitBranch, MessagesSquare } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { EmptyStateScene, SceneBar, SceneHeader, ScenePanel, SceneRow, SceneSlot } from '@cherrystudio/ui'

/** A subagent call with no captured child messages: the selected call and its empty child flow. */
export function SubagentFlowEmptyScene() {
  const { t } = useTranslation()
  return (
    <EmptyStateScene
      size="panel"
      accent={4}
      sprites={[
        { x: 232, y: 3, color: 7, shape: 'ring', tilt: 10 },
        { x: 4, y: 80, color: 2, shape: 'checker', tilt: -12 },
        { x: 240, y: 120, color: 4, shape: 'corner', tilt: 8 }
      ]}>
      <ScenePanel className="absolute top-[10px] left-[18px] h-[190px] w-[224px]">
        <SceneHeader icon={GitBranch} title={t('agent.right_pane.flow.no_messages.title')} />
        <div className="flex flex-col gap-[6px] px-[10px] pt-[10px]">
          <SceneRow selected icon={Bot} label={<SceneBar className="w-[86px] bg-current opacity-40" />} />
          <SceneSlot className="ml-[14px] h-[78px] justify-center">
            <MessagesSquare size={18} strokeWidth={1.4} className="text-foreground-disabled" />
          </SceneSlot>
        </div>
      </ScenePanel>
    </EmptyStateScene>
  )
}
