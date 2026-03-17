import { Tag } from '@cherrystudio/ui'
import { CheckIcon } from 'lucide-react'

type Props = {
  iconSize?: number
  message: string
}

export const SuccessTag = ({ iconSize: size = 14, message }: Props) => {
  return (
    <Tag icon={<CheckIcon size={size} color="var(--color-status-success)" />} color="var(--color-status-success)">
      {message}
    </Tag>
  )
}
