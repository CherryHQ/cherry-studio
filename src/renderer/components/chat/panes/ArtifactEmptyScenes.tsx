import { CircleCheck, FileCode, FileJson, Folder } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import {
  EmptyStateScene,
  SceneBar,
  SceneCaret,
  SceneChip,
  SceneCursor,
  SceneHeader,
  ScenePanel,
  SceneRow,
  SceneTabs
} from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'

const CODE_LINES = 7

/** Artifact pane before the agent writes anything: an empty code view with the caret on line one. */
export function ArtifactReadyScene() {
  const { t } = useTranslation()
  return (
    <EmptyStateScene
      size="panel"
      accent={7}
      sprites={[
        { x: 232, y: 3, color: 5, shape: 'cross', tilt: 10 },
        { x: 4, y: 96, color: 8, shape: 'ring', tilt: -12 },
        { x: 240, y: 118, color: 7, shape: 'corner', tilt: 8 }
      ]}>
      <ScenePanel className="absolute top-[10px] left-[18px] h-[190px] w-[224px]">
        <SceneHeader
          title={
            <SceneTabs items={[t('agent.preview_pane.preview'), t('agent.preview_pane.code')]} className="pt-[6px]" />
          }
          trailing={<SceneChip icon={CircleCheck} label={t('agent.preview_pane.empty.title')} />}
        />
        <div className="flex flex-col gap-[6px] px-[12px] pt-[9px] font-mono text-[6.5px] text-foreground-tertiary">
          {Array.from({ length: CODE_LINES }, (_, index) => (
            <div key={index} className="flex h-[10px] items-center gap-[8px]">
              <span className="w-[8px] text-right">{index + 1}</span>
              {index === 0 && <SceneCaret />}
            </div>
          ))}
        </div>
      </ScenePanel>
    </EmptyStateScene>
  )
}

const TREE = [
  { icon: Folder, width: 'w-[30px]', indent: false },
  { icon: FileCode, width: 'w-[38px]', indent: true },
  { icon: FileCode, width: 'w-[30px]', indent: true },
  { icon: FileCode, width: 'w-[42px]', indent: true },
  { icon: FileJson, width: 'w-[44px]', indent: false }
]

/** Nothing open yet: the file tree with the pointer on a file and an empty preview beside it. */
export function ArtifactOpenScene() {
  const { t } = useTranslation()
  return (
    <EmptyStateScene
      size="panel"
      accent={5}
      sprites={[
        { x: 232, y: 3, color: 1, shape: 'checker', tilt: 10 },
        { x: 4, y: 70, color: 4, shape: 'corner', tilt: -12 },
        { x: 240, y: 118, color: 5, shape: 'ring', tilt: 8 }
      ]}>
      <ScenePanel className="absolute top-[10px] left-[18px] h-[190px] w-[224px] flex-row">
        <div className="flex w-[96px] shrink-0 flex-col gap-[3px] border-r border-border-subtle p-[6px]">
          <span className="truncate px-[4px] pb-[3px] text-[8.5px] font-semibold text-foreground">
            {t('agent.right_pane.tabs.files')}
          </span>
          {TREE.map(({ icon, width, indent }, index) => (
            <SceneRow
              key={index}
              icon={icon}
              selected={index === 2}
              className={indent ? 'pl-[14px]' : undefined}
              label={<SceneBar className={index === 2 ? cn(width, 'bg-current opacity-40') : width} />}
            />
          ))}
        </div>
        <div className="flex flex-1 items-center justify-center">
          <FileCode size={28} strokeWidth={1.3} className="text-foreground-disabled" />
        </div>
      </ScenePanel>
      <SceneCursor className="top-[81px] left-[90px]" />
    </EmptyStateScene>
  )
}
