import type { ComponentPropsWithoutRef } from 'react'
import type { ExtraProps } from 'streamdown'

export function FootnoteSection({
  children,
  node,
  ...props
}: ComponentPropsWithoutRef<'section'> & ExtraProps & Record<string, unknown>) {
  // Streamdown memoizes generated nodes without positions as equal even when their contents change.
  return (
    <section key={JSON.stringify(node)} {...props}>
      {children}
    </section>
  )
}

export function FootnoteLink({
  children,
  node,
  ...props
}: ComponentPropsWithoutRef<'a'> & ExtraProps & Record<string, unknown>) {
  void node
  return (
    <a
      {...props}
      className="rounded-sm text-primary underline focus-visible:outline-2 focus-visible:outline-ring"
      onClick={(event) => {
        event.preventDefault()
        const href = event.currentTarget.getAttribute('href')
        if (!href) return
        const target = event.currentTarget.ownerDocument.getElementById(decodeURIComponent(href.slice(1)))
        if (!target) return
        target.scrollIntoView({ block: 'nearest' })
        if (target.tagName !== 'A') target.tabIndex = -1
        target.focus({ preventScroll: true })
      }}>
      {children}
    </a>
  )
}
