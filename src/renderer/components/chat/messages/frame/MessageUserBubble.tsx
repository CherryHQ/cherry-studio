import type { ReactNode } from 'react'

export function MessageUserBubble({
  children,
  messageFont,
  fontSize
}: {
  children: ReactNode
  messageFont: string
  fontSize: number
}) {
  return (
    <div
      data-ui="part:message-content"
      className="message-content-container mt-0 max-w-full rounded-[10px] bg-muted px-4 py-2.5 empty:hidden has-[.code-block]:w-full [&_.block-wrapper:last-child>*:last-child]:mb-0! [&_.markdown>p:last-child]:mb-0!"
      style={{
        fontFamily: messageFont === 'serif' ? 'var(--font-family-serif)' : 'var(--font-family)',
        fontSize,
        overflowY: 'visible'
      }}>
      {children}
    </div>
  )
}
