import { FileText, Scissors } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { EmptyStateScene, SceneBar, SceneGhostRow, SceneHeader, ScenePanel, SceneSlot } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'

import { KNOWLEDGE_DATA_SOURCE_TYPES } from '../../components/addKnowledgeItemDialog/constants'
import { dataSourceTypeDisplayConfig } from './utils/models'

const COLUMNS = ['name', 'type', 'status'] as const

/** A base without sources: one tile per source type (the first is the accent) above an empty table. */
export function DataSourceEmptyScene() {
  const { t } = useTranslation()
  return (
    <EmptyStateScene
      accent={2}
      sprites={[
        { x: 280, y: 3, color: 7, shape: 'checker', tilt: 10 },
        { x: 4, y: 92, color: 4, shape: 'ring', tilt: -12 },
        { x: 292, y: 150, color: 2, shape: 'corner', tilt: 8 }
      ]}>
      <ScenePanel className="absolute top-[13px] left-[21px] h-[220px] w-[270px]">
        <SceneHeader title={t('knowledge.data_source.table.aria_label')} />
        <div className="grid grid-cols-4 gap-[8px] px-[14px] pt-[11px]">
          {KNOWLEDGE_DATA_SOURCE_TYPES.map((source, index) => {
            const Icon = dataSourceTypeDisplayConfig[source.value].icon.icon
            const label = <span className="truncate text-[7px]">{t(source.labelKey)}</span>
            return index === 0 ? (
              <SceneSlot
                key={source.value}
                accent
                className="h-[48px] flex-col justify-center gap-[5px] rounded-[8px] font-semibold">
                <Icon size={13} strokeWidth={1.8} />
                {label}
              </SceneSlot>
            ) : (
              <div
                key={source.value}
                className="flex h-[48px] flex-col items-center justify-center gap-[5px] rounded-[8px] border border-border-subtle bg-muted text-muted-foreground">
                <Icon size={13} strokeWidth={1.8} />
                {label}
              </div>
            )
          })}
        </div>
        <div className="mx-[14px] mt-[12px] flex border-b border-border-subtle pb-[4px] text-[6.8px] text-foreground-tertiary">
          {COLUMNS.map((column) => (
            <span key={column} className={cn('truncate', column === 'name' ? 'flex-1' : 'w-[52px]')}>
              {t(`knowledge.data_source.table.columns.${column}`)}
            </span>
          ))}
        </div>
        <div className="flex flex-col gap-[6px] px-[12px] pt-[7px]">
          <SceneGhostRow lead />
          <SceneGhostRow lead />
        </div>
      </ScenePanel>
    </EmptyStateScene>
  )
}

const PARAGRAPHS = [
  ['w-full', 'w-11/12', 'w-2/3'],
  ['w-full', 'w-5/6', 'w-3/4'],
  ['w-11/12', 'w-full', 'w-1/2']
]

/** An item not split yet: its text with accent cut lines where the chunks will fall. */
export function ChunkEmptyScene() {
  return (
    <EmptyStateScene
      size="panel"
      accent={4}
      sprites={[
        { x: 232, y: 3, color: 7, shape: 'ring', tilt: 10 },
        { x: 4, y: 84, color: 1, shape: 'corner', tilt: -12 },
        { x: 240, y: 120, color: 4, shape: 'checker', tilt: 8 }
      ]}>
      <ScenePanel className="absolute top-[10px] left-[18px] h-[190px] w-[224px]">
        <SceneHeader icon={FileText} title={<SceneBar className="w-[70px] bg-muted-foreground opacity-50" />} />
        <div className="flex flex-col gap-[6px] px-[12px] pt-[10px]">
          {PARAGRAPHS.map((widths, index) => (
            <div key={index} className="flex flex-col gap-[4px]">
              {widths.map((width, line) => (
                <SceneBar key={line} className={cn(width, 'ml-[16px] max-w-[176px]')} />
              ))}
              <SceneSlot accent className="h-0 gap-[4px] border-0 border-t bg-transparent pt-0">
                <Scissors size={9} strokeWidth={2} className="-mt-[1px] shrink-0 bg-card" />
              </SceneSlot>
            </div>
          ))}
        </div>
      </ScenePanel>
    </EmptyStateScene>
  )
}
