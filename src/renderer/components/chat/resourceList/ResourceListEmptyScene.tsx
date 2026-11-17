import { Plus, SquarePen } from 'lucide-react'

import { EmptyStateScene, SceneGhostRow, ScenePanel, SceneSlot } from '@cherrystudio/ui'

/** Empty sidebar list (topics, tasks, assistants, agents): its header and an accent "new" row. */
export function ResourceListEmptyScene({
  title,
  addLabel,
  lead = false
}: {
  title: string
  addLabel: string
  lead?: boolean
}) {
  return (
    <EmptyStateScene
      size="sidebar"
      accent={1}
      sprites={[
        { x: 166, y: 2, color: 4, shape: 'corner', tilt: 10 },
        { x: 2, y: 62, color: 6, shape: 'checker', tilt: -12 },
        { x: 174, y: 100, color: 1, shape: 'ring', tilt: 8 }
      ]}>
      <ScenePanel className="absolute top-[8px] left-[15px] h-[150px] w-[158px] gap-[5px] p-[8px]">
        <div className="flex h-[16px] items-center px-[3px] text-[9px] font-semibold text-foreground">
          <span className="truncate">{title}</span>
          <SquarePen size={10} strokeWidth={1.8} className="ml-auto shrink-0 text-muted-foreground" />
        </div>
        <SceneSlot accent className="h-[20px] gap-[5px] px-[7px] text-[7.5px] font-semibold">
          <Plus size={9} strokeWidth={2.4} className="shrink-0" />
          <span className="truncate">{addLabel}</span>
        </SceneSlot>
        <SceneGhostRow lead={lead} />
        <SceneGhostRow lead={lead} />
        <SceneGhostRow lead={lead} />
      </ScenePanel>
    </EmptyStateScene>
  )
}
