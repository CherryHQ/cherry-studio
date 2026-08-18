import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { ZAiAvatar } from './avatar'
import { ZAiDark } from './dark'
import { ZAiLight } from './light'

const ZAi = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <ZAiLight {...props} className={className} />
  if (variant === 'dark') return <ZAiDark {...props} className={className} />
  return (
    <>
      <ZAiLight className={cn('dark:hidden', className)} {...props} />
      <ZAiDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const ZAiIcon: CompoundIcon = /*#__PURE__*/ Object.assign(ZAi, {
  Avatar: ZAiAvatar,
  colorPrimary: '#000000'
})

export default ZAiIcon
