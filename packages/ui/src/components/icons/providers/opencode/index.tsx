import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { OpencodeAvatar } from './avatar'
import { OpencodeDark } from './dark'
import { OpencodeLight } from './light'

const Opencode = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <OpencodeLight {...props} className={className} />
  if (variant === 'dark') return <OpencodeDark {...props} className={className} />
  return (
    <>
      <OpencodeLight className={cn('dark:hidden', className)} {...props} />
      <OpencodeDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const OpencodeIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Opencode, {
  Avatar: OpencodeAvatar,
  colorPrimary: '#211E1E'
})

export default OpencodeIcon
