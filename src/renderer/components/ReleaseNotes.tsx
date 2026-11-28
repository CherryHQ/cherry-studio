import type { Root } from 'mdast'
import type { ComponentPropsWithoutRef, FC } from 'react'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { visit } from 'unist-util-visit'

import { Markdown } from '@cherrystudio/ui'
import { cn } from '@renderer/utils/style'

const RELEASE_NOTE_CATEGORY_PREFIX = 'release-note-category:'

function remarkReleaseNoteCategories() {
  return (tree: Root) => {
    visit(tree, 'listItem', (item) => {
      const paragraph = item.children[0]
      if (paragraph?.type !== 'paragraph') return
      const text = paragraph.children[0]
      if (text?.type !== 'text') return
      const match = text.value.match(/^\[([^\]`\r\n]{1,32})\](?=\s)/)
      if (!match) return
      text.value = text.value.slice(match[0].length)
      paragraph.children.unshift({ type: 'inlineCode', value: `${RELEASE_NOTE_CATEGORY_PREFIX}${match[1].trim()}` })
    })
  }
}

const remarkPlugins = [remarkReleaseNoteCategories]

function ReleaseNoteInlineCode({ children, node, ...props }: ComponentPropsWithoutRef<'code'> & { node?: unknown }) {
  void node
  const value = typeof children === 'string' ? children : ''

  if (value.startsWith(RELEASE_NOTE_CATEGORY_PREFIX)) {
    return (
      <span className="inline-flex items-center whitespace-nowrap rounded-sm border border-border-subtle bg-background-subtle px-1.5 py-0.5 align-middle font-medium text-foreground text-xs leading-4">
        {value.slice(RELEASE_NOTE_CATEGORY_PREFIX.length)}
      </span>
    )
  }

  return <code {...props}>{children}</code>
}

type ReleaseNotesProps = {
  content: string
  className?: string
}

export const ReleaseNotes: FC<ReleaseNotesProps> = ({ content, className }) => {
  const id = useId()
  const { t } = useTranslation()
  return (
    <Markdown
      key={content}
      id={id}
      footnoteLabel={t('common.footnotes')}
      remarkPlugins={remarkPlugins}
      className={cn(
        'text-muted-foreground text-sm leading-6 [&>div>p:first-child]:text-[15px] [&>div>p:not(:first-child)]:pt-2 [&>div>p]:font-medium [&>div>p]:text-foreground [&>div]:space-y-3 [&_li]:my-0! [&_li]:py-1 [&_ol]:my-0! [&_ol]:list-outside [&_ol]:pl-5 [&_p]:m-0! [&_ul]:my-0! [&_ul]:list-outside [&_ul]:pl-5',
        className
      )}
      components={{ inlineCode: ReleaseNoteInlineCode }}>
      {content}
    </Markdown>
  )
}
