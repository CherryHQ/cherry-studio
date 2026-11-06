import { createEvent, fireEvent, render, screen } from '@testing-library/react'
import type { Element } from 'hast'
import type { ComponentType, ImgHTMLAttributes, MouseEvent, PropsWithChildren } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { MarkdownHostProvider } from '../MarkdownHostProvider'
import { MarkdownLinkRenderer, useMarkdownComponents } from '../MarkdownRenderers'

vi.mock('@cherrystudio/ui', () => ({
  HoverCard: ({ children }: PropsWithChildren) => children,
  HoverCardContent: ({ children }: PropsWithChildren) => children,
  HoverCardTrigger: ({ children }: PropsWithChildren) => children
}))

vi.mock('@renderer/components/CodeBlockView/CodeBlockView', () => ({
  CodeBlockView: ({ children, showToolbar = true }: PropsWithChildren<{ showToolbar?: boolean }>) => (
    <div>
      {showToolbar ? <button type="button">Code actions</button> : null}
      <code>{children}</code>
    </div>
  )
}))

vi.mock('@renderer/components/icons/FallbackFavicon', () => ({
  default: () => <span data-testid="favicon" />
}))

vi.mock('@renderer/components/ImageViewer', () => ({
  default: (props: ImgHTMLAttributes<HTMLImageElement>) => <img {...props} />
}))

vi.mock('@renderer/components/OgCard', () => ({
  OgCard: () => <span data-testid="metadata-card" />
}))

const imageNode = {
  type: 'element',
  tagName: 'img',
  properties: { alt: 'Broken chart', src: 'https://example.com/broken.png' },
  children: []
} as Element

const imageLinkNode = {
  type: 'element',
  tagName: 'a',
  properties: { href: 'https://example.com' },
  children: [imageNode]
} as Element

const bareUrlNode = {
  type: 'element',
  tagName: 'a',
  properties: { href: 'https://example.com/a/very/long/path' },
  children: [{ type: 'text', value: 'https://example.com/a/very/long/path' }]
} as Element

function Renderer({ name, ...props }: { name: 'a' | 'code' | 'img'; [key: string]: unknown }) {
  const components = useMarkdownComponents({ hasStyleElement: false })
  const Component = components[name] as ComponentType<Record<string, unknown>>
  return <Component {...props} />
}

describe('MarkdownRenderers', () => {
  it('keeps in-page anchors clickable', () => {
    const scrollIntoView = vi.fn()
    render(
      <div className="markdown">
        <Renderer name="a" href="#section-1">
          Go to section
        </Renderer>
        <h2
          id="heading-preview--section-1"
          ref={(element) => {
            if (element) element.scrollIntoView = scrollIntoView
          }}>
          Section 1
        </h2>
      </div>
    )

    const anchor = screen.getByRole('link', { name: 'Go to section' })
    expect(anchor).toHaveAttribute('href', '#section-1')
    expect(anchor).not.toHaveAttribute('target')
    fireEvent.click(anchor)
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start' })
  })

  it('does not put a favicon on its own line before a linked image', () => {
    render(
      <Renderer name="a" href="https://example.com" node={imageLinkNode}>
        <img alt="Badge" src="https://example.com/badge.svg" />
      </Renderer>
    )

    expect(screen.getByRole('link', { name: 'Badge' })).toBeInTheDocument()
    expect(screen.queryByTestId('favicon')).not.toBeInTheDocument()
  })

  it('lets a bare URL wrap without an orphaned favicon', () => {
    render(
      <Renderer name="a" href="https://example.com/a/very/long/path" node={bareUrlNode}>
        https://example.com/a/very/long/path
      </Renderer>
    )

    expect(screen.getByRole('link', { name: 'https://example.com/a/very/long/path' })).toBeInTheDocument()
    expect(screen.queryByTestId('favicon')).not.toBeInTheDocument()
  })

  it('replaces a broken fixed-size image with an aligned fallback', () => {
    render(
      <Renderer
        name="img"
        alt="Broken chart"
        src="https://example.com/broken.png"
        width={240}
        height={120}
        node={imageNode}
      />
    )

    fireEvent.error(screen.getByRole('img', { name: 'Broken chart' }))

    const fallback = screen.getByRole('img', { name: 'Broken chart' })
    expect(fallback.tagName).toBe('SPAN')
    expect(fallback).toHaveTextContent('Broken chart')
    expect(fallback).toHaveStyle({ width: '240px', height: '120px' })
  })

  it('names an unresolved relative image without issuing an image load', () => {
    render(
      <MarkdownHostProvider resolveImageSrc={() => null}>
        <Renderer name="img" src="images/missing.png" alt=" " />
      </MarkdownHostProvider>
    )
    const placeholder = screen.getByRole('img', { name: 'images/missing.png' })
    expect(placeholder).toHaveTextContent('images/missing.png')
    expect(placeholder.tagName).toBe('SPAN')
  })

  it('does not carry a failed image across different effective sources', () => {
    const view = render(
      <MarkdownHostProvider resolveImageSrc={() => 'file:///tmp/first/images/x.png'}>
        <Renderer name="img" src="images/x.png" alt="diagram" />
      </MarkdownHostProvider>
    )
    fireEvent.error(screen.getByRole('img', { name: 'diagram' }))
    expect(screen.getByRole('img', { name: 'diagram' }).tagName).toBe('SPAN')
    view.rerender(
      <MarkdownHostProvider resolveImageSrc={() => 'file:///tmp/second/images/x.png'}>
        <Renderer name="img" src="images/x.png" alt="diagram" />
      </MarkdownHostProvider>
    )
    expect(screen.getByRole('img', { name: 'diagram' })).toHaveAttribute('src', 'file:///tmp/second/images/x.png')
  })

  it('retains the empty-alt failure behavior for images the resolver leaves unchanged', () => {
    const { container } = render(
      <MarkdownHostProvider resolveImageSrc={(src) => src}>
        <Renderer name="img" src="https://example.com/missing.png" alt="" />
      </MarkdownHostProvider>
    )
    fireEvent.error(container.querySelector('img')!)
    expect(container.querySelector('img')).toBeNull()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(container.textContent).toBe('')
  })

  it('preserves text nested in animation spans in inline code', () => {
    render(
      <Renderer name="code">
        <span>live</span>
        <span> code</span>
      </Renderer>
    )
    expect(screen.getByText('live')).toBeVisible()
    expect(screen.getByText('code')).toBeVisible()
    expect(document.body).not.toHaveTextContent('[object Object]')
  })
})

describe('application URL links', () => {
  it.each(['zotero://select/items/Note', 'obsidian://new?file=Note', 'siyuan://blocks/Note', 'vscode://file/tmp/note'])(
    'opens %s once without mounting web metadata',
    (href) => {
      const openExternalUrl = vi.fn()
      render(
        <MarkdownHostProvider openExternalUrl={openExternalUrl}>
          <Renderer name="a" href={href}>
            Application note
          </Renderer>
        </MarkdownHostProvider>
      )
      const anchor = screen.getByRole('link', { name: 'Application note' })
      const event = createEvent.click(anchor)
      fireEvent(anchor, event)
      expect(event.defaultPrevented).toBe(true)
      expect(openExternalUrl).toHaveBeenCalledExactlyOnceWith(href)
      expect(screen.queryByTestId('metadata-card')).not.toBeInTheDocument()
      expect(screen.queryByTestId('favicon')).not.toBeInTheDocument()
    }
  )
})

it.each(['http://example.test', 'https://example.test'])(
  'preserves web clicks, modifiers and caller cancellation for %s',
  (href) => {
    const openExternalUrl = vi.fn()
    const onClick = vi.fn()
    const view = render(
      <Renderer name="a" href={href} openExternalUrl={openExternalUrl} onClick={onClick}>
        Website
      </Renderer>
    )
    const anchor = screen.getByRole('link', { name: 'Website' })
    for (const modifier of ['metaKey', 'ctrlKey', 'shiftKey', 'altKey']) {
      const event = createEvent.click(anchor, { [modifier]: true })
      fireEvent(anchor, event)
      expect(event.defaultPrevented).toBe(false)
    }
    const middleClick = createEvent.click(anchor, { button: 1 })
    fireEvent(anchor, middleClick)
    expect(middleClick.defaultPrevented).toBe(false)
    expect(openExternalUrl).not.toHaveBeenCalled()
    const event = createEvent.click(anchor)
    fireEvent(anchor, event)
    expect(event.defaultPrevented).toBe(true)
    expect(openExternalUrl).toHaveBeenCalledExactlyOnceWith(href)
    expect(onClick).toHaveBeenCalled()
    openExternalUrl.mockClear()
    view.rerender(
      <Renderer
        name="a"
        href={href}
        openExternalUrl={openExternalUrl}
        onClick={(click: MouseEvent) => click.preventDefault()}>
        Website
      </Renderer>
    )
    fireEvent.click(anchor)
    expect(openExternalUrl).not.toHaveBeenCalled()
  }
)

it('keeps file capability routing ahead of external URL routing', () => {
  const openFilePath = vi.fn()
  const openExternalUrl = vi.fn()
  render(
    <Renderer name="a" href="./notes.md" openFilePath={openFilePath} openExternalUrl={openExternalUrl}>
      File note
    </Renderer>
  )
  const anchor = screen.getByRole('link', { name: 'File note' })
  const event = createEvent.click(anchor)
  fireEvent(anchor, event)
  expect(event.defaultPrevented).toBe(true)
  expect(openFilePath).toHaveBeenCalledExactlyOnceWith('./notes.md')
  expect(openExternalUrl).not.toHaveBeenCalled()
})

describe('bare image URLs', () => {
  it('renders an autolinked network image URL as an image', () => {
    const url = 'https://example.com/pic.png?x=1'
    const A = MarkdownLinkRenderer
    render(<A href={url}>{url}</A>)
    expect(screen.getByRole('img')).toHaveAttribute('src', url)
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('renders a percent-encoded non-ASCII bare image URL as an image', () => {
    const A = MarkdownLinkRenderer
    render(<A href="https://example.com/%E5%9B%BE%E7%89%87.png">https://example.com/图片.png</A>)
    expect(screen.getByRole('img')).toHaveAttribute('src', 'https://example.com/%E5%9B%BE%E7%89%87.png')
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('matches the label against a scheme-normalized href', () => {
    const A = MarkdownLinkRenderer
    render(<A href="https://example.com/pic.png">HTTPS://example.com/pic.png</A>)
    expect(screen.getByRole('img')).toHaveAttribute('src', 'https://example.com/pic.png')
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('renders a bare image URL split into streaming animation spans as an image', () => {
    const A = MarkdownLinkRenderer
    render(
      <A href="https://example.com/%E5%9B%BE%E7%89%87.png">
        <span data-sd-animate>https://example.com/</span>
        <span data-sd-animate>图片</span>
        <span data-sd-animate>.png</span>
      </A>
    )
    expect(screen.getByRole('img')).toHaveAttribute('src', 'https://example.com/%E5%9B%BE%E7%89%87.png')
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('reads labels through surface-mapped animation components', () => {
    const A = MarkdownLinkRenderer
    const ChatLikeSpan = ({ children, ...rest }: PropsWithChildren<Record<string, unknown>>) => (
      <span {...rest}>{children}</span>
    )
    render(
      <A href="https://example.com/pic.png?x=1">
        <ChatLikeSpan data-sd-animate>https://example.com/</ChatLikeSpan>
        <ChatLikeSpan data-sd-animate>pic.png?x=1</ChatLikeSpan>
      </A>
    )
    expect(screen.getByRole('img')).toHaveAttribute('src', 'https://example.com/pic.png?x=1')
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('keeps a double-encoded label distinct from its destination as a link', () => {
    const A = MarkdownLinkRenderer
    render(<A href="https://example.com/%2F.png">https://example.com/%252F.png</A>)
    expect(screen.queryByRole('img')).toBeNull()
    expect(screen.getAllByRole('link')).toHaveLength(1)
  })

  it('renders a bare image URL as a keyboard-focusable image', () => {
    const A = MarkdownLinkRenderer
    const url = 'https://example.com/pic.png'
    render(<A href={url}>{url}</A>)
    const img = screen.getByRole('img')
    expect(img).toHaveAttribute('tabindex', '0')
    img.focus()
    expect(img).toHaveFocus()
    fireEvent.keyDown(img, { key: 'Enter' })
    fireEvent.keyDown(img, { key: ' ' })
  })

  it('keeps labels wrapped in non-animation elements as links', () => {
    const A = MarkdownLinkRenderer
    render(
      <A href="https://example.com/pic.png">
        <span>https://example.com/pic.png</span>
      </A>
    )
    expect(screen.queryByRole('img')).toBeNull()
    expect(screen.getAllByRole('link')).toHaveLength(1)
  })

  it('keeps labelled links and non-image URLs as links', () => {
    const A = MarkdownLinkRenderer
    render(
      <>
        <A href="https://example.com/pic.png">label</A>
        <A href="https://example.com/page">https://example.com/page</A>
      </>
    )
    expect(screen.queryByRole('img')).toBeNull()
    expect(screen.getAllByRole('link')).toHaveLength(2)
  })
})
