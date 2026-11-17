import { CircleDashed, EyeOff, ExternalLink, File, FileWarning, FileX2, FolderOpen } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { EmptyStateScene, SceneBar, SceneButton, SceneHeader, ScenePanel } from '@cherrystudio/ui'

export type FilePreviewEmptyKind = 'unsupported' | 'directory' | 'invalid_path' | 'unavailable' | 'load_error' | 'empty'

const KIND_ICON = {
  unsupported: EyeOff,
  directory: FolderOpen,
  invalid_path: FileX2,
  unavailable: FileWarning,
  load_error: FileWarning,
  empty: CircleDashed
} as const

/** A file that cannot be shown inline: the preview pane with a card naming why; only "unsupported" can open externally. */
export function FilePreviewEmptyScene({ kind }: { kind: FilePreviewEmptyKind }) {
  const { t } = useTranslation()
  const Icon = KIND_ICON[kind]
  return (
    <EmptyStateScene
      size="panel"
      accent={2}
      sprites={[
        { x: 232, y: 3, color: 5, shape: 'checker', tilt: 10 },
        { x: 4, y: 82, color: 6, shape: 'ring', tilt: -12 },
        { x: 240, y: 120, color: 2, shape: 'corner', tilt: 8 }
      ]}>
      <ScenePanel className="absolute top-[10px] left-[18px] h-[190px] w-[224px]">
        <SceneHeader
          icon={File}
          title={<SceneBar className="w-[70px] bg-muted-foreground opacity-50" />}
          trailing={
            kind === 'unsupported' ? <SceneButton accent icon={ExternalLink} label={t('files.open')} /> : undefined
          }
        />
        <div className="flex flex-1 items-start justify-center pt-[18px]">
          <div className="flex h-[78px] w-[62px] flex-col items-center justify-center gap-[10px] rounded-[9px] border border-border border-t-border-strong bg-card shadow-md">
            <Icon size={20} strokeWidth={1.5} className="text-foreground-tertiary" />
            <SceneBar className="w-[28px]" />
          </div>
        </div>
      </ScenePanel>
    </EmptyStateScene>
  )
}
