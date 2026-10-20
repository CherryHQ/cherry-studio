import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { BilibiliindexAvatar } from './avatar'
import { BilibiliindexDark } from './dark'
import { BilibiliindexLight } from './light'

const Bilibiliindex = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <BilibiliindexLight {...props} className={className} />
  if (variant === 'dark') return <BilibiliindexDark {...props} className={className} />
  return (
    <>
      <BilibiliindexLight className={cn('dark:hidden', className)} {...props} />
      <BilibiliindexDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const BilibiliindexIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Bilibiliindex, {
  Avatar: BilibiliindexAvatar,
  colorPrimary: '#000000'
})

export default BilibiliindexIcon
