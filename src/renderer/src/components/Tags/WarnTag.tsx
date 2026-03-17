import { Tag } from '@cherrystudio/ui'
import { AlertTriangleIcon } from 'lucide-react'

type Props = {
  iconSize?: number
  message: string
}

export const WarnTag = ({ iconSize: size = 14, message }: Props) => {
  return (
    <Tag
      icon={<AlertTriangleIcon size={size} color="var(--color-status-warning)" />}
      color="var(--color-status-warning)">
      {message}
    </Tag>
  )
}
