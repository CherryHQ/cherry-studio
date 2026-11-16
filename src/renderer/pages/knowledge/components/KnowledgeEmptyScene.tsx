import { FileText, FileUp, Library, Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import {
  EmptyStateScene,
  SceneButton,
  SceneCursor,
  SceneFloat,
  SceneHeader,
  ScenePanel,
  SceneSlot
} from '@cherrystudio/ui'

// Format names, not translatable words.
const SOURCE_FORMATS = ['PDF', 'DOCX', 'MD', 'URL']

/** No knowledge bases yet: the knowledge panel with its drop zone, a file being dragged in. */
export function KnowledgeEmptyScene() {
  const { t } = useTranslation()
  return (
    <EmptyStateScene
      accent={2}
      sprites={[
        { x: 276, y: 3, color: 5, shape: 'checker', tilt: 12 },
        { x: 8, y: 91, color: 8, shape: 'corner', tilt: -10 },
        { x: 289, y: 156, color: 2, shape: 'cross', tilt: 8 }
      ]}>
      <ScenePanel className="absolute top-[13px] left-[26px] h-[220px] w-[260px]">
        <SceneHeader
          icon={Library}
          title={t('knowledge.title')}
          trailing={<SceneButton icon={Plus} label={t('common.add')} />}
        />
        <div className="px-[18px] pt-[13px]">
          <SceneSlot accent className="h-[83px] flex-col justify-center gap-[6px]">
            <FileUp size={18} strokeWidth={1.6} />
            <span className="text-[8px] text-muted-foreground">{t('files.drag_upload')}</span>
            <span className="flex gap-[5px]">
              {SOURCE_FORMATS.map((format) => (
                <span
                  key={format}
                  className="rounded-[4px] border border-border-strong px-[4px] text-[6px] leading-[11px] font-semibold text-foreground-tertiary">
                  {format}
                </span>
              ))}
            </span>
          </SceneSlot>
        </div>
      </ScenePanel>
      <SceneFloat className="top-[128px] left-[192px]">
        <ScenePanel className="h-[26px] w-[84px] -rotate-6 flex-row items-center gap-[5px] rounded-[7px] px-[7px]">
          <FileText size={11} strokeWidth={1.8} className="shrink-0 text-muted-foreground" />
          <span className="truncate text-[7.3px] text-foreground">{t('knowledge.empty_scene.sample_file')}</span>
        </ScenePanel>
        <SceneCursor className="top-[15px] left-[64px]" />
      </SceneFloat>
    </EmptyStateScene>
  )
}
