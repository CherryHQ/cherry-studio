import { getToolName, isToolUIPart } from 'ai'
import { File, Wrench } from 'lucide-react'
import type { Components } from 'streamdown'

import { Markdown } from '@cherrystudio/ui'
import type { CherryUIMessage } from '@shared/data/types/message'

import { isAskUserQuestionToolName, parseAskUserQuestionToolInput } from '../tools/shared/agentToolTypes'

const components: Partial<Components> = {
  a: ({ children }) => <span className="text-link">{children}</span>,
  pre: ({ children }) => (
    <pre className="max-h-24 overflow-hidden whitespace-pre-wrap break-all rounded bg-muted p-2">{children}</pre>
  ),
  code: ({ children }) => <code>{children}</code>,
  img: ({ alt }) => <span className="text-muted-foreground">{alt || '▧'}</span>,
  table: ({ children }) => <table className="w-full table-fixed overflow-hidden">{children}</table>,
  input: () => null
}

export function MessagePreviewContent({
  message,
  renderInputMessageAsMarkdown = true
}: {
  message: CherryUIMessage
  renderInputMessageAsMarkdown?: boolean
}) {
  return message.parts.slice(-8).map((part, index) => {
    const key = `${message.id}-${index}`
    if (part.type === 'text') {
      const user = message.role === 'user'
      const clipped = !user && part.text.length > 2400
      const text = user ? part.text : part.text.slice(-2400)
      return (
        <div key={key}>
          {clipped && <span aria-hidden>…</span>}
          {user && !renderInputMessageAsMarkdown ? (
            <div className="whitespace-pre-wrap break-words">{text}</div>
          ) : (
            <Markdown
              id={key}
              components={components}
              disallowedElements={['video', 'audio', 'iframe', 'button', 'svg']}
              className="markdown text-inherit leading-relaxed [&>*:last-child]:mb-0">
              {text}
            </Markdown>
          )}
        </div>
      )
    }
    if (isToolUIPart(part)) {
      const name = getToolName(part)
      const questions = isAskUserQuestionToolName(name)
        ? parseAskUserQuestionToolInput(part.input)?.questions
        : undefined
      return (
        <div key={key} className="rounded-md bg-muted p-2 text-xs">
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Wrench className="size-3" />
            {name}
          </div>
          {questions ? (
            questions.map((question) => (
              <div key={question.question} className="mt-2">
                <p>{question.question}</p>
                {question.options.map((option) => (
                  <p key={option.label} className="text-muted-foreground">
                    · {option.label}
                  </p>
                ))}
              </div>
            ))
          ) : part.state === 'approval-requested' ? (
            <pre className="mt-1 max-h-24 overflow-hidden whitespace-pre-wrap break-all">
              {JSON.stringify(part.input, null, 2)?.slice(0, 1200)}
            </pre>
          ) : null}
          {part.state === 'output-error' && <p className="mt-1 text-error">{part.errorText}</p>}
        </div>
      )
    }
    if (part.type === 'file')
      return (
        <div key={key} className="flex items-center gap-1 text-xs text-muted-foreground">
          <File className="size-3" />
          {part.filename || part.mediaType}
        </div>
      )
    if (part.type === 'data-error')
      return (
        <p key={key} className="text-xs text-error">
          {typeof part.data.message === 'string' ? part.data.message : ''}
        </p>
      )
    return null
  })
}
