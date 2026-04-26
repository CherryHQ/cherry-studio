import type { ProviderSettingsDisplayModel } from '@renderer/pages/settings/ProviderSettingsV2/config/models'
import { memo } from 'react'

import ModelTagsWithLabelV2 from './ModelTagsWithLabelV2'

interface ModelIdWithTagsV2Props {
  model: ProviderSettingsDisplayModel
  fontSize?: React.CSSProperties['fontSize']
  showIdentifier?: boolean
  style?: React.CSSProperties
}

const ModelIdWithTagsV2 = ({
  ref,
  model,
  fontSize = 'var(--font-size-body-md)',
  showIdentifier = false,
  style
}: ModelIdWithTagsV2Props & { ref?: React.RefObject<HTMLDivElement> | null }) => {
  const shouldShowIdentifier = showIdentifier && model.id !== model.name

  return (
    <div
      ref={ref}
      className="flex min-w-0 items-center gap-2.5 text-foreground leading-[1.2]"
      style={{ fontSize, ...style }}>
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span className="block min-w-0 shrink overflow-hidden text-ellipsis whitespace-nowrap font-medium leading-[1.3]">
          {model.name}
        </span>
        {shouldShowIdentifier && (
          <span
            className="min-w-0 max-w-[50%] shrink truncate rounded-md bg-foreground/[0.05] px-1.5 py-[1px] font-mono text-muted-foreground text-[length:var(--font-size-body-xs)]! leading-[1.2]"
            title={model.id}>
            {model.id}
          </span>
        )}
      </div>
      <ModelTagsWithLabelV2 model={model} size={11} style={{ flexShrink: 0 }} />
    </div>
  )
}

export default memo(ModelIdWithTagsV2)
