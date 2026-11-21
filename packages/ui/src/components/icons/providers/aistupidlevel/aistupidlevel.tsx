import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { AistupidlevelAvatar } from './avatar'
import { AistupidlevelDark } from './dark'
import { AistupidlevelLight } from './light'

const Aistupidlevel = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <AistupidlevelLight {...props} className={className} />
  if (variant === 'dark') return <AistupidlevelDark {...props} className={className} />
  return (
    <>
      <AistupidlevelLight className={cn('dark:hidden', className)} {...props} />
      <AistupidlevelDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const AistupidlevelIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Aistupidlevel, {
  Avatar: AistupidlevelAvatar,
  colorPrimary: '#005DFB'
})

export default AistupidlevelIcon
