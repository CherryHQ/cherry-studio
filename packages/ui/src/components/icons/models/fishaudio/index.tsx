import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { FishaudioAvatar } from './avatar'
import { FishaudioDark } from './dark'
import { FishaudioLight } from './light'

const Fishaudio = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <FishaudioLight {...props} className={className} />
  if (variant === 'dark') return <FishaudioDark {...props} className={className} />
  return (
    <>
      <FishaudioLight className={cn('dark:hidden', className)} {...props} />
      <FishaudioDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const FishaudioIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Fishaudio, {
  Avatar: FishaudioAvatar,
  colorPrimary: '#000000'
})

export default FishaudioIcon
