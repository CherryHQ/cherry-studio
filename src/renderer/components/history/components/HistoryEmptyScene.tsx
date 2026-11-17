import { Filter, History, X } from 'lucide-react'

import { EmptyStateScene, SceneBar, SceneChip, SceneGhostRow, ScenePanel } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'

/** No records for the current filters: the record table filtered down to empty rows. */
export function HistoryEmptyScene({ title }: { title: string }) {
  return (
    <EmptyStateScene
      accent={2}
      sprites={[
        { x: 276, y: 3, color: 5, shape: 'ring', tilt: 10 },
        { x: 6, y: 96, color: 8, shape: 'corner', tilt: -12 },
        { x: 290, y: 152, color: 2, shape: 'cross', tilt: 8 }
      ]}>
      <ScenePanel className="absolute top-[13px] left-[21px] h-[220px] w-[270px]">
        <div className="flex h-[34px] shrink-0 items-center gap-[6px] px-[13px]">
          <History size={12} strokeWidth={1.8} className="shrink-0 text-foreground" />
          <span className="truncate text-[9px] font-semibold text-foreground">{title}</span>
        </div>
        <div className="flex gap-[5px] border-b border-border-subtle px-[13px] pb-[9px]">
          {['w-[56px]', 'w-[70px]'].map((width) => (
            <SceneChip
              key={width}
              accent
              icon={Filter}
              label={
                <span className="flex items-center gap-[3px]">
                  <SceneBar className={cn(width, 'bg-current opacity-50')} />
                  <X size={7} strokeWidth={2.4} />
                </span>
              }
            />
          ))}
        </div>
        <div className="flex flex-col gap-[6px] px-[10px] pt-[10px]">
          <SceneGhostRow lead />
          <SceneGhostRow lead />
          <SceneGhostRow lead />
          <SceneGhostRow lead />
        </div>
      </ScenePanel>
    </EmptyStateScene>
  )
}
