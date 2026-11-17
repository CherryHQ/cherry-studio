import { Server, Settings2, SquareTerminal } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import {
  EmptyStateScene,
  SceneBar,
  SceneCursor,
  SceneHeader,
  ScenePanel,
  SceneRow,
  SceneToggle
} from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'

const TOOL_WIDTHS = ['w-[44px]', 'w-[30px]', 'w-[40px]', 'w-[34px]', 'w-[38px]']

/** No CLI tool selected: the tool list with the pointer on one tool and an empty configuration pane. */
export function CodeToolSelectScene() {
  const { t } = useTranslation()
  return (
    <EmptyStateScene
      accent={7}
      sprites={[
        { x: 280, y: 3, color: 1, shape: 'cross', tilt: 10 },
        { x: 4, y: 96, color: 4, shape: 'ring', tilt: -12 },
        { x: 292, y: 150, color: 7, shape: 'checker', tilt: 8 }
      ]}>
      <ScenePanel className="absolute top-[13px] left-[18px] h-[220px] w-[276px] flex-row">
        <div className="flex w-[124px] shrink-0 flex-col gap-[3px] border-r border-border-subtle p-[8px]">
          <span className="truncate px-[4px] pb-[4px] text-[9px] font-semibold text-foreground">{t('title.code')}</span>
          {TOOL_WIDTHS.map((width, index) => (
            <SceneRow
              key={width}
              icon={SquareTerminal}
              selected={index === 1}
              label={<SceneBar className={cn(width, index === 1 && 'bg-current opacity-40')} />}
            />
          ))}
        </div>
        <div className="flex flex-1 flex-col items-center justify-center gap-[8px]">
          <Settings2 size={28} strokeWidth={1.3} className="text-foreground-disabled" />
          <SceneBar className="w-[64px]" />
          <SceneBar className="w-[44px]" />
        </div>
      </ScenePanel>
      <SceneCursor className="top-[80px] left-[98px]" />
    </EmptyStateScene>
  )
}

const PROVIDER_WIDTHS = ['w-[54px]', 'w-[40px]', 'w-[48px]', 'w-[36px]']

/** No enabled providers: the provider list with every switch off, the first one marked as the step to take. */
export function CodeProvidersEmptyScene() {
  return (
    <EmptyStateScene
      accent={2}
      sprites={[
        { x: 280, y: 3, color: 5, shape: 'checker', tilt: 10 },
        { x: 4, y: 90, color: 8, shape: 'corner', tilt: -12 },
        { x: 292, y: 150, color: 2, shape: 'cross', tilt: 8 }
      ]}>
      <ScenePanel className="absolute top-[13px] left-[21px] h-[220px] w-[270px]">
        <SceneHeader icon={Server} title={<SceneBar className="w-[60px] bg-muted-foreground opacity-50" />} />
        <div className="flex flex-col px-[14px] pt-[6px]">
          {PROVIDER_WIDTHS.map((width, index) => (
            <div
              key={width}
              className="flex h-[26px] items-center gap-[8px] border-b border-border-subtle last:border-b-0">
              <span className="size-[13px] shrink-0 rounded-full border border-border-strong bg-muted" />
              <SceneBar className={width} />
              <span className="ml-auto">
                <SceneToggle accent={index === 0} />
              </span>
            </div>
          ))}
        </div>
      </ScenePanel>
    </EmptyStateScene>
  )
}
