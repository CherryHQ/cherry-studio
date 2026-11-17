import { CalendarClock, Clock, MessageSquareDashed } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { EmptyStateScene, SceneBar, SceneCursor, ScenePanel, SceneRow } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'

const TASKS = [
  { width: 'w-[46px]', time: '9:00' },
  { width: 'w-[30px]', time: '18:00' },
  { width: 'w-[40px]', time: '7:30' },
  { width: 'w-[36px]', time: '12:00' }
]

/** No task selected: the task list with the pointer on one task and an empty conversation beside it. */
export function ScheduledTaskEmptyScene() {
  const { t } = useTranslation()
  return (
    <EmptyStateScene
      accent={3}
      sprites={[
        { x: 280, y: 3, color: 6, shape: 'cross', tilt: 10 },
        { x: 4, y: 92, color: 2, shape: 'checker', tilt: -12 },
        { x: 292, y: 150, color: 3, shape: 'ring', tilt: 8 }
      ]}>
      <ScenePanel className="absolute top-[13px] left-[18px] h-[220px] w-[276px] flex-row">
        <div className="flex w-[124px] shrink-0 flex-col gap-[3px] border-r border-border-subtle p-[8px]">
          <div className="flex items-center gap-[5px] px-[4px] pb-[4px] text-[9px] font-semibold text-foreground">
            <CalendarClock size={11} strokeWidth={1.8} className="shrink-0" />
            <span className="truncate">{t('settings.scheduledTasks.title')}</span>
          </div>
          {TASKS.map(({ width, time }, index) => (
            <SceneRow
              key={time}
              icon={Clock}
              selected={index === 0}
              meta={time}
              label={<SceneBar className={cn(width, index === 0 && 'bg-current opacity-40')} />}
            />
          ))}
        </div>
        <div className="flex flex-1 items-center justify-center">
          <MessageSquareDashed size={28} strokeWidth={1.3} className="text-foreground-disabled" />
        </div>
      </ScenePanel>
      <SceneCursor className="top-[59px] left-[84px]" />
    </EmptyStateScene>
  )
}
