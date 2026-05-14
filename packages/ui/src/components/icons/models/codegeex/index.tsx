import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { CodegeexAvatar } from './avatar'
import { CodegeexDark } from './dark'
import { CodegeexLight } from './light'

const Codegeex = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <CodegeexLight {...props} className={className} />
  if (variant === 'dark') return <CodegeexDark {...props} className={className} />
  return (
    <>
      <CodegeexLight className={cn('dark:hidden', className)} {...props} />
      <CodegeexDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const CodegeexIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Codegeex, {
  Avatar: CodegeexAvatar,
  colorPrimary: '#171E1E'
})

export default CodegeexIcon
