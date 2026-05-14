import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { VolcengineAvatar } from './avatar'
import { VolcengineDark } from './dark'
import { VolcengineLight } from './light'

const Volcengine = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <VolcengineLight {...props} className={className} />
  if (variant === 'dark') return <VolcengineDark {...props} className={className} />
  return (
    <>
      <VolcengineLight className={cn('dark:hidden', className)} {...props} />
      <VolcengineDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const VolcengineIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Volcengine, {
  Avatar: VolcengineAvatar,
  colorPrimary: '#00E5E5'
})

export default VolcengineIcon
