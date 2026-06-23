import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { OgCard } from '../OgCard'

const mocks = vi.hoisted(() => ({
  OgCard: vi.fn(),
  parseMetadata: vi.fn(),
  useMetaDataParser: vi.fn()
}))

vi.mock('og-crd', () => ({
  OgCard: ({
    thumbnail,
    title,
    description,
    href,
    aspectRatio,
    hoverEffect,
    className
  }: {
    thumbnail?: ReactNode
    title: string
    description?: string
    href?: string
    aspectRatio?: number
    hoverEffect?: string
    className?: string
  }) => {
    mocks.OgCard({ thumbnail, title, description, href, aspectRatio, hoverEffect, className })

    return (
      <div
        data-testid="og-crd-card"
        data-href={href}
        data-aspect-ratio={aspectRatio}
        data-hover-effect={hoverEffect}
        className={className}>
        {thumbnail}
        <span data-testid="og-crd-title">{title}</span>
        <span data-testid="og-crd-description">{description}</span>
      </div>
    )
  }
}))

vi.mock('@cherrystudio/ui', () => ({
  Skeleton: ({ className }: { className?: string }) => <div data-testid="skeleton" className={className} />
}))

vi.mock('@renderer/hooks/useMetaDataParser', () => ({
  useMetaDataParser: mocks.useMetaDataParser
}))

describe('OgCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.useMetaDataParser.mockReturnValue({
      metadata: {
        'og:title': 'Example title',
        'og:description': 'Example description',
        'og:image': 'https://example.com/image.png',
        'og:imageAlt': 'Example image'
      },
      isLoading: false,
      parseMetadata: mocks.parseMetadata
    })
  })

  it('renders metadata with og-crd card', () => {
    render(<OgCard link="https://example.com/article" show />)

    expect(screen.getByTestId('og-crd-card')).toHaveAttribute('data-href', 'https://example.com/article')
    expect(screen.getByTestId('og-crd-card')).toHaveAttribute('data-aspect-ratio', String(760 / 420))
    expect(screen.getByTestId('og-crd-card')).toHaveAttribute('data-hover-effect', 'none')
    expect(screen.getByTestId('og-crd-card')).toHaveClass('h-full w-full')
    expect(screen.getByTestId('og-crd-card').parentElement).toHaveClass('aspect-760/420 w-100 max-w-[calc(100vw-32px)]')
    expect(screen.getByTestId('og-crd-title')).toHaveTextContent('Example title')
    expect(screen.getByTestId('og-crd-description')).toHaveTextContent('Example description')

    const image = screen.getByRole('img', { name: 'Example image' })
    expect(image).toHaveAttribute('src', 'https://example.com/image.png')
    expect(image).toHaveClass('h-full w-full bg-muted')
    expect(image).toHaveStyle({ objectFit: 'cover' })
  })

  it('uses hostname and fallback thumbnail when metadata has no image', () => {
    mocks.useMetaDataParser.mockReturnValue({
      metadata: {},
      isLoading: false,
      parseMetadata: mocks.parseMetadata
    })

    render(<OgCard link="https://example.com/article" show />)

    expect(screen.getByTestId('og-crd-card').querySelector('.bg-accent')).toHaveClass('h-full w-full bg-accent')
    expect(screen.getByTestId('og-crd-title')).toHaveTextContent('example.com')
    expect(screen.getByTestId('og-crd-description')).toHaveTextContent('https://example.com/article')
  })

  it('uses document fallback metadata when Open Graph fields are absent', () => {
    mocks.useMetaDataParser.mockReturnValue({
      metadata: {
        title: 'Fallback title',
        description: 'Fallback description',
        image: 'https://example.com/fallback.png'
      },
      isLoading: false,
      parseMetadata: mocks.parseMetadata
    })

    render(<OgCard link="https://example.com/article" show />)

    expect(screen.getByTestId('og-crd-title')).toHaveTextContent('Fallback title')
    expect(screen.getByTestId('og-crd-description')).toHaveTextContent('Fallback description')
    expect(screen.getByRole('img', { name: 'Fallback title' })).toHaveAttribute(
      'src',
      'https://example.com/fallback.png'
    )
  })

  it('keeps lazy metadata parsing behavior', () => {
    mocks.useMetaDataParser.mockReturnValue({
      metadata: {},
      isLoading: true,
      parseMetadata: mocks.parseMetadata
    })

    render(<OgCard link="https://example.com/article" show />)

    expect(screen.getByTestId('skeleton')).toHaveClass('h-full w-full rounded-none')
    expect(mocks.parseMetadata).toHaveBeenCalledOnce()
  })
})
