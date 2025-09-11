import { CheckIcon } from 'lucide-react'

import CustomTag from './CustomTag'

type Props = {
  iconSize?: number
  message: string
}

export const SuccessTag = ({ iconSize: size = 14, message }: Props) => {
  return (
    <CustomTag icon={<CheckIcon size={size} color="var(--color-status-success)" />} color="var(--color-status-success)">
      {message}
    </CustomTag>
  )
}
