import { CustomTag, type CustomTagProps } from '@cherrystudio/ui'
import { AudioLines, Brain, Eye, Globe, Video, Wrench } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import type { ModelSelectorTag } from './filters'

type Props = {
  tag: ModelSelectorTag
  size?: number
  showTooltip?: boolean
  showLabel?: boolean
} & Omit<CustomTagProps, 'size' | 'tooltip' | 'icon' | 'color' | 'children'>

type TagMeta = {
  color: string
  labelKey: string
  supportsTooltip: boolean
  respectsShowLabel: boolean
  renderIcon: (label: string, size: number) => ReactNode
}

const TAG_META = {
  'image-recognition': {
    color: 'var(--color-green-500)',
    labelKey: 'models.type.vision',
    supportsTooltip: true,
    respectsShowLabel: true,
    renderIcon: (_label, size) => <Eye size={size} color="currentColor" className="text-current" />
  },
  'audio-recognition': {
    color: 'var(--color-fuchsia-500)',
    labelKey: 'models.type.audio',
    supportsTooltip: true,
    respectsShowLabel: true,
    renderIcon: (_label, size) => <AudioLines size={size} color="currentColor" className="text-current" />
  },
  'video-recognition': {
    color: 'var(--color-pink-500)',
    labelKey: 'models.type.video',
    supportsTooltip: true,
    respectsShowLabel: true,
    renderIcon: (_label, size) => <Video size={size} color="currentColor" className="text-current" />
  },
  reasoning: {
    color: 'var(--color-indigo-500)',
    labelKey: 'models.type.reasoning',
    supportsTooltip: true,
    respectsShowLabel: true,
    renderIcon: (_label, size) => <Brain size={size} color="currentColor" className="text-current" />
  },
  'function-call': {
    color: 'var(--color-orange-500)',
    labelKey: 'models.type.function_calling',
    supportsTooltip: true,
    respectsShowLabel: true,
    renderIcon: (_label, size) => <Wrench size={size} color="currentColor" className="text-current" />
  },
  'web-search': {
    color: 'var(--color-blue-500)',
    labelKey: 'models.type.websearch',
    supportsTooltip: true,
    respectsShowLabel: true,
    renderIcon: (_label, size) => <Globe size={size} color="currentColor" className="text-current" />
  },
  embedding: {
    color: 'var(--color-amber-500)',
    labelKey: 'models.type.embedding',
    supportsTooltip: false,
    respectsShowLabel: false,
    renderIcon: (label) => label
  },
  rerank: {
    color: 'var(--color-sky-500)',
    labelKey: 'models.type.rerank',
    supportsTooltip: false,
    respectsShowLabel: false,
    renderIcon: (label) => label
  },
  free: {
    color: 'var(--color-lime-500)',
    labelKey: 'models.type.free',
    supportsTooltip: true,
    respectsShowLabel: false,
    renderIcon: (label) => label
  }
} as const satisfies Record<ModelSelectorTag, TagMeta>

export function ModelTagChip({ tag, size = 12, showTooltip, showLabel, ...restProps }: Props) {
  const { t } = useTranslation()
  const meta = TAG_META[tag]
  const label = t(meta.labelKey)

  return (
    <CustomTag
      size={size}
      color={meta.color}
      icon={meta.renderIcon(label, size)}
      tooltip={meta.supportsTooltip && showTooltip ? label : undefined}
      {...restProps}>
      {meta.respectsShowLabel && showLabel ? label : ''}
    </CustomTag>
  )
}
