import { withFullMarkdown } from '@cherrystudio/ui'

import type { ChatMarkdownProps } from './ChatMarkdown'
import ChatMarkdownRuntime from './ChatMarkdownRuntime'

const createMermaidPlugins = (singleDollarMath: boolean) => withFullMarkdown({ singleDollarMath })

export default function ChatMarkdownMermaidRuntime(props: ChatMarkdownProps) {
  return <ChatMarkdownRuntime {...props} createPlugins={createMermaidPlugins} />
}
