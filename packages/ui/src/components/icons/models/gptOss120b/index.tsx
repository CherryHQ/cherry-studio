import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { GptOss120bAvatar } from './avatar'
import { GptOss120bDark } from './dark'
import { GptOss120bLight } from './light'

const GptOss120b = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <GptOss120bLight {...props} className={className} />
  if (variant === 'dark') return <GptOss120bDark {...props} className={className} />
  return (
    <>
      <GptOss120bLight className={cn('dark:hidden', className)} {...props} />
      <GptOss120bDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const GptOss120bIcon: CompoundIcon = /*#__PURE__*/ Object.assign(GptOss120b, {
  Avatar: GptOss120bAvatar,
  colorPrimary: '#000000'
})

export default GptOss120bIcon
