import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { PaddleocrAvatar } from './avatar'
import { PaddleocrDark } from './dark'
import { PaddleocrLight } from './light'

const Paddleocr = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <PaddleocrLight {...props} className={className} />
  if (variant === 'dark') return <PaddleocrDark {...props} className={className} />
  return (
    <>
      <PaddleocrLight className={cn('dark:hidden', className)} {...props} />
      <PaddleocrDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const PaddleocrIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Paddleocr, {
  Avatar: PaddleocrAvatar,
  colorPrimary: '#363FE5'
})

export default PaddleocrIcon
