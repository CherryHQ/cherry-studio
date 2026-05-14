import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { ArceeAiAvatar } from './avatar'
import { ArceeAiDark } from './dark'
import { ArceeAiLight } from './light'

const ArceeAi = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <ArceeAiLight {...props} className={className} />
  if (variant === 'dark') return <ArceeAiDark {...props} className={className} />
  return (
    <>
      <ArceeAiLight className={cn('dark:hidden', className)} {...props} />
      <ArceeAiDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const ArceeAiIcon: CompoundIcon = /*#__PURE__*/ Object.assign(ArceeAi, {
  Avatar: ArceeAiAvatar,
  colorPrimary: '#008C8C'
})

export default ArceeAiIcon
