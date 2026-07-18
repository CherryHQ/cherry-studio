// @vitest-environment jsdom

/**
 * End-to-end regression for opening file-path markdown links.
 *
 * The renderer test setup globally mocks `@cherrystudio/ui` to a passthrough, so
 * this suite imports the real `<Markdown>` via its deep path to exercise the
 * genuine markdown → rehype-sanitize → rehype-harden → `<Link>` pipeline (not a
 * stub). It guards the boundary that unit-level `<Link>` tests cannot see: whether
 * a link destination even survives sanitization/hardening with its href intact.
 *
 * In particular, a raw Windows drive path (`C:/…`) is stripped by rehype-sanitize
 * (its `C:` reads as a `c:` scheme) and `file://` is hard-blocked by rehype-harden,
 * so `remarkFileLinks` roots drive paths (`/C:/…`) to thread both stages.
 */

import { Markdown } from '@cherrystudio/ui/components/composites/markdown/markdown'
import { MarkdownHostContext } from '@renderer/hooks/useMarkdownHost'
import { fireEvent, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import Link from '../Link'
import { remarkFileLinks } from '../remarkFileLinks'

vi.mock('@renderer/components/icons/FallbackFavicon', () => ({ __esModule: true, default: () => null }))
vi.mock('../Hyperlink', () => ({ default: ({ children }: { children: React.ReactNode }) => <span>{children}</span> }))

const REMARK_PLUGINS = [remarkFileLinks]

function renderMarkdown(source: string, openFilePath: (path: string) => void) {
  const components = { a: (props: Record<string, unknown>) => <Link {...props} /> }
  return render(
    <MarkdownHostContext value={{ openFilePath }}>
      <Markdown id="t" remarkPlugins={REMARK_PLUGINS} components={components as never}>
        {source}
      </Markdown>
    </MarkdownHostContext>
  )
}

describe('file-path markdown links (real sanitize + harden pipeline)', () => {
  it.each([
    ['forward-slash drive path', '[readme](C:/Users/Alice/project/README.md)', 'C:/Users/Alice/project/README.md'],
    ['back-slash drive path', '[readme](C:\\Users\\Alice\\project\\README.md)', 'C:/Users/Alice/project/README.md'],
    ['drive path with hash', '[readme](C:/Users/Alice/notes.md#top)', 'C:/Users/Alice/notes.md'],
    ['POSIX absolute path', '[log](/var/log/app.log)', '/var/log/app.log']
  ])('routes a %s to the host opener', (_label, source, expected) => {
    const openFilePath = vi.fn()
    const { container } = renderMarkdown(source, openFilePath)

    const anchor = container.querySelector('a')
    // The href must have survived sanitize/harden — otherwise Streamdown renders a
    // "[blocked]" span instead of an anchor and the click can never reach the opener.
    expect(anchor).not.toBeNull()

    fireEvent.click(anchor as HTMLAnchorElement)
    expect(openFilePath).toHaveBeenCalledWith(expected)
  })

  it('leaves a web link as a normal external anchor (opener not called)', () => {
    const openFilePath = vi.fn()
    const { container } = renderMarkdown('[site](https://example.com/page)', openFilePath)

    const anchor = container.querySelector('a') as HTMLAnchorElement
    fireEvent.click(anchor)
    expect(openFilePath).not.toHaveBeenCalled()
  })
})
