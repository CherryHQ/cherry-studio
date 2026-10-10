import type { FC } from 'react'

import { AppMarkdown, type AppMarkdownProps } from './AppMarkdown'

type Props = Pick<AppMarkdownProps, 'children' | 'id' | 'className' | 'components' | 'paragraphLayout'>

export const StaticMarkdown: FC<Props> = ({ className, ...props }) => (
  <AppMarkdown {...props} className={['static-markdown', className].filter(Boolean).join(' ')} />
)
