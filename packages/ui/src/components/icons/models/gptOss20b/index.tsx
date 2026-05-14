import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { GptOss20bAvatar } from './avatar'
import { GptOss20bDark } from './dark'
import { GptOss20bLight } from './light'

const GptOss20b = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <GptOss20bLight {...props} className={className} />
  if (variant === 'dark') return <GptOss20bDark {...props} className={className} />
  return (
    <>
      <GptOss20bLight className={cn('dark:hidden', className)} {...props} />
      <GptOss20bDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const GptOss20bIcon: CompoundIcon = /*#__PURE__*/ Object.assign(GptOss20b, {
  Avatar: GptOss20bAvatar,
  colorPrimary: '#000000'
})

export default GptOss20bIcon
