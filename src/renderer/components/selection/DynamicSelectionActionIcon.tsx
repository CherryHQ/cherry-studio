import { DynamicIcon, type IconName } from 'lucide-react/dynamic'
import type { ComponentProps, FC, ReactNode } from 'react'

type DynamicSelectionActionIconProps = Omit<ComponentProps<typeof DynamicIcon>, 'fallback' | 'name'> & {
  fallback?: () => ReactNode
  name: string
}

const DynamicSelectionActionIcon: FC<DynamicSelectionActionIconProps> = ({ fallback, name, ...props }) => {
  return <DynamicIcon fallback={fallback} name={name as IconName} {...props} />
}

export default DynamicSelectionActionIcon
