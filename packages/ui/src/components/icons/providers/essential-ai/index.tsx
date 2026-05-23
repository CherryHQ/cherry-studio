import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { EssentialAiAvatar } from './avatar'
import { EssentialAiDark } from './dark'
import { EssentialAiLight } from './light'

const EssentialAi = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <EssentialAiLight {...props} className={className} />
  if (variant === 'dark') return <EssentialAiDark {...props} className={className} />
  return (
    <>
      <EssentialAiLight className={cn('dark:hidden', className)} {...props} />
      <EssentialAiDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const EssentialAiIcon: CompoundIcon = /*#__PURE__*/ Object.assign(EssentialAi, {
  Avatar: EssentialAiAvatar,
  colorPrimary: '#35058E'
})

export default EssentialAiIcon
