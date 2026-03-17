import { Tag } from '@cherrystudio/ui'
import { CircleXIcon } from 'lucide-react'

type Props = {
  iconSize?: number
  message: string
}

export const ErrorTag = ({ iconSize: size = 14, message }: Props) => {
  return (
    <Tag icon={<CircleXIcon size={size} color="var(--color-status-error)" />} color="var(--color-status-error)">
      {message}
    </Tag>
  )
}
