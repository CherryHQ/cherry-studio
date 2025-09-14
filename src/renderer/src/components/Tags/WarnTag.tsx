import { AlertTriangleIcon } from 'lucide-react'

import CustomTag from './CustomTag'

type Props = {
  iconSize?: number
  message: string
}

export const WarnTag = ({ iconSize: size = 14, message }: Props) => {
  return (
    <CustomTag
      icon={<AlertTriangleIcon size={size} color="var(--color-status-warning)" />}
      color="var(--color-status-warning)">
      {message}
    </CustomTag>
  )
}
