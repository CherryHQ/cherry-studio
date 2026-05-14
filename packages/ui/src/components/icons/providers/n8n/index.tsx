import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { N8nAvatar } from './avatar'
import { N8nDark } from './dark'
import { N8nLight } from './light'

const N8n = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <N8nLight {...props} className={className} />
  if (variant === 'dark') return <N8nDark {...props} className={className} />
  return (
    <>
      <N8nLight className={cn('dark:hidden', className)} {...props} />
      <N8nDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const N8nIcon: CompoundIcon = /*#__PURE__*/ Object.assign(N8n, {
  Avatar: N8nAvatar,
  colorPrimary: '#EA4B71'
})

export default N8nIcon
