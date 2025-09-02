import { COLOR_ERROR } from '@renderer/config/constant'
import { CircleXIcon } from 'lucide-react'

import CustomTag from './CustomTag'

type Props = {
  iconSize?: number
  message: string
}

export const ErrorTag = ({ iconSize: size = 14, message }: Props) => {
  return (
    <CustomTag icon={<CircleXIcon size={size} color={COLOR_ERROR} />} color={COLOR_ERROR}>
      {message}
    </CustomTag>
  )
}
