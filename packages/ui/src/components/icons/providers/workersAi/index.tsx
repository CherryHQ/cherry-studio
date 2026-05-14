import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { WorkersAiAvatar } from './avatar'
import { WorkersAiDark } from './dark'
import { WorkersAiLight } from './light'

const WorkersAi = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <WorkersAiLight {...props} className={className} />
  if (variant === 'dark') return <WorkersAiDark {...props} className={className} />
  return (
    <>
      <WorkersAiLight className={cn('dark:hidden', className)} {...props} />
      <WorkersAiDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const WorkersAiIcon: CompoundIcon = /*#__PURE__*/ Object.assign(WorkersAi, {
  Avatar: WorkersAiAvatar,
  colorPrimary: '#F38020'
})

export default WorkersAiIcon
