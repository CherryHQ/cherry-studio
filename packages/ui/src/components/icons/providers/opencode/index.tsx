import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { OpenCodeGoAvatar } from './avatar'
import { OpenCodeGoDark } from './dark'
import { OpenCodeGoLight } from './light'

const OpenCodeGo = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <OpenCodeGoLight {...props} className={className} />

  if (variant === 'dark') return <OpenCodeGoDark {...props} className={className} />

  return (
    <>
      <OpenCodeGoLight className={cn('dark:hidden', className)} {...props} />
      <OpenCodeGoDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const OpenCodeGoIcon: CompoundIcon = /*#__PURE__*/ Object.assign(OpenCodeGo, {
  Avatar: OpenCodeGoAvatar,
  colorPrimary: '#131010'
})

export default OpenCodeGoIcon
