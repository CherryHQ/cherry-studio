import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { NeteaseYoudaoAvatar } from './avatar'
import { NeteaseYoudaoDark } from './dark'
import { NeteaseYoudaoLight } from './light'

const NeteaseYoudao = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <NeteaseYoudaoLight {...props} className={className} />
  if (variant === 'dark') return <NeteaseYoudaoDark {...props} className={className} />
  return (
    <>
      <NeteaseYoudaoLight className={cn('dark:hidden', className)} {...props} />
      <NeteaseYoudaoDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const NeteaseYoudaoIcon: CompoundIcon = /*#__PURE__*/ Object.assign(NeteaseYoudao, {
  Avatar: NeteaseYoudaoAvatar,
  colorPrimary: '#E01E00'
})

export default NeteaseYoudaoIcon
