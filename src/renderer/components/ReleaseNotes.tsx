import type { ComponentPropsWithoutRef, FC } from 'react'
import { Streamdown } from 'streamdown'

import { cn } from '@renderer/utils/style'

const RELEASE_NOTE_CATEGORY_PREFIX = 'release-note-category:'
const RELEASE_NOTE_CATEGORY_PATTERN = /^(\s*[-*+]\s+)\[([^\]`\r\n]{1,32})\](?=\s)/gm

const formatReleaseNoteCategories = (releaseNotes: string) =>
  releaseNotes.replace(
    RELEASE_NOTE_CATEGORY_PATTERN,
    (_match, listMarker: string, category: string) =>
      `${listMarker}\`${RELEASE_NOTE_CATEGORY_PREFIX}${category.trim()}\``
  )

function ReleaseNoteInlineCode({ children, node, ...props }: ComponentPropsWithoutRef<'code'> & { node?: unknown }) {
  void node
  const value = typeof children === 'string' ? children : ''

  if (value.startsWith(RELEASE_NOTE_CATEGORY_PREFIX)) {
    return (
      <span className="inline-flex items-center rounded-sm border border-border-subtle bg-background-subtle px-1.5 py-0.5 align-middle text-xs leading-4 font-medium whitespace-nowrap text-foreground">
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

export const ReleaseNotes: FC<ReleaseNotesProps> = ({ content, className }) => (
  <div
    className={cn(
      'markdown text-sm leading-6 text-muted-foreground [&_li]:my-0! [&_li]:py-1 [&_ol]:my-0! [&_ol]:list-outside [&_ol]:pl-5 [&_p]:m-0! [&_ul]:my-0! [&_ul]:list-outside [&_ul]:pl-5 [&>div]:space-y-3 [&>div>p]:font-medium [&>div>p]:text-foreground [&>div>p:first-child]:text-[15px] [&>div>p:not(:first-child)]:pt-2',
      className
    )}>
    <Streamdown mode="static" components={{ inlineCode: ReleaseNoteInlineCode }}>
      {formatReleaseNoteCategories(content)}
    </Streamdown>
  </div>
)
