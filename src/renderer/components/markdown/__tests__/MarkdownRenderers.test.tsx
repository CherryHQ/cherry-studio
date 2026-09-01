import { fireEvent, render, screen } from '@testing-library/react'
import type { Element } from 'hast'
import type { ComponentType, ImgHTMLAttributes, PropsWithChildren } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { useMarkdownComponents } from '../MarkdownRenderers'

vi.mock('@cherrystudio/ui', () => ({
  HoverCard: ({ children }: PropsWithChildren) => children,
  HoverCardContent: ({ children }: PropsWithChildren) => children,
  HoverCardTrigger: ({ children }: PropsWithChildren) => children
}))

vi.mock('@renderer/components/CodeBlockView/CodeBlockView', () => ({
  CodeBlockView: ({ children, showToolbar }: PropsWithChildren<{ showToolbar?: boolean }>) => (
    <div>
      {showToolbar ? <button type="button">Diagram actions</button> : null}
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
  OgCard: () => null
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

  it('keeps diagram actions available for Mermaid previews', () => {
    render(
      <Renderer name="code" className="language-mermaid">
        {'graph TD; A-->B\n'}
      </Renderer>
    )

    expect(screen.getByRole('button', { name: 'Diagram actions' })).toBeInTheDocument()
  })
})
