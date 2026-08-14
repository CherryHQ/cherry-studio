import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { NamiAiAvatar } from './avatar'
import { NamiAiDark } from './dark'
import { NamiAiLight } from './light'

const NamiAi = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <NamiAiLight {...props} className={className} />
  if (variant === 'dark') return <NamiAiDark {...props} className={className} />
  return (
    <>
      <NamiAiLight className={cn('dark:hidden', className)} {...props} />
      <NamiAiDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const NamiAiIcon: CompoundIcon = /*#__PURE__*/ Object.assign(NamiAi, {
  Avatar: NamiAiAvatar,
  colorPrimary: '#000000'
})

export default NamiAiIcon
