import { DynamicIcon, iconNames } from 'lucide-react/dynamic'
import type { ComponentProps, FC, ReactNode } from 'react'

type DynamicSelectionActionIconProps = Omit<ComponentProps<typeof DynamicIcon>, 'fallback' | 'name'> & {
  fallback?: () => ReactNode
  name: string
}

const DynamicSelectionActionIcon: FC<DynamicSelectionActionIconProps> = ({ fallback, name, ...props }) => {
  const iconName = iconNames.find((candidate) => candidate === name)

  if (!iconName) return fallback?.() ?? null

  return <DynamicIcon fallback={fallback} name={iconName} {...props} />
}

export default DynamicSelectionActionIcon
