// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import {
  Box,
  Center,
  ColFlex,
  Container,
  Flex,
  Grid,
  HStack,
  PageShell,
  RowFlex,
  SpaceBetweenRowFlex,
  Spacer,
  Stack,
  TruncatingRow,
  VStack
} from '../index'

afterEach(() => {
  cleanup()
})

const slot = (container: HTMLElement, name: string) =>
  container.querySelector(`[data-slot="${name}"]`) as HTMLElement | null

describe('Box', () => {
  it('renders a box-border div and forwards ref', () => {
    const ref: { current: HTMLDivElement | null } = { current: null }
    const { container } = render(<Box ref={ref} className="p-2" />)
    const box = slot(container, 'box')!
    expect(box.tagName).toBe('DIV')
    expect(box).toHaveClass('box-border', 'p-2')
    expect(ref.current).toBe(box)
  })

  it('merges onto the child element when asChild', () => {
    const { getByTestId } = render(
      <Box asChild>
        <a href="/x" data-testid="link" />
      </Box>
    )
    const link = getByTestId('link')
    expect(link.tagName).toBe('A')
    expect(link).toHaveClass('box-border')
  })
})

describe('Flex prop → class mapping', () => {
  it('maps direction/align/justify/gap/wrap/inline to fixed utility classes', () => {
    const { container } = render(<Flex direction="col" align="center" justify="between" gap={2} wrap inline />)
    const el = slot(container, 'flex')!
    expect(el).toHaveClass('inline-flex', 'flex-col', 'items-center', 'justify-between', 'gap-2', 'flex-wrap')
    expect(el).not.toHaveClass('flex')
  })

  it('supports axis-specific gap objects', () => {
    const { container } = render(<Flex gap={{ x: 2, y: 3 }} />)
    expect(slot(container, 'flex')!).toHaveClass('gap-x-2', 'gap-y-3')
  })

  it('lets className win over a prop via tailwind-merge', () => {
    const { container } = render(<Flex gap={2} className="gap-4" />)
    const el = slot(container, 'flex')!
    expect(el).toHaveClass('gap-4')
    expect(el).not.toHaveClass('gap-2')
  })
})

describe('Stack presets', () => {
  it('HStack is a vertically-centered row with default gap-2', () => {
    const { container } = render(<HStack />)
    expect(slot(container, 'hstack')!).toHaveClass('flex', 'flex-row', 'items-center', 'gap-2')
  })

  it('VStack is a stretched column with default gap-2', () => {
    const { container } = render(<VStack />)
    expect(slot(container, 'vstack')!).toHaveClass('flex', 'flex-col', 'items-stretch', 'gap-2')
  })

  it('Stack defaults to a column', () => {
    const { container } = render(<Stack />)
    expect(slot(container, 'stack')!).toHaveClass('flex-col', 'gap-2')
  })
})

describe('Center', () => {
  it('centers on both axes', () => {
    const { container } = render(<Center />)
    expect(slot(container, 'center')!).toHaveClass('flex', 'items-center', 'justify-center')
  })
})

describe('Grid', () => {
  it('maps a numeric column count to grid-cols-N with default gap-3', () => {
    const { container } = render(<Grid columns={3} />)
    expect(slot(container, 'grid')!).toHaveClass('grid', 'grid-cols-3', 'gap-3')
  })

  it('maps a responsive columns object to static breakpoint classes', () => {
    const { container } = render(<Grid columns={{ base: 1, sm: 2, lg: 3 }} gap={4} />)
    expect(slot(container, 'grid')!).toHaveClass('grid-cols-1', 'sm:grid-cols-2', 'lg:grid-cols-3', 'gap-4')
  })
})

describe('TruncatingRow', () => {
  it('bakes the parent truncation chain and shrink-0 slots', () => {
    const { container } = render(
      <TruncatingRow leading={<i data-testid="lead" />} trailing={<i data-testid="trail" />}>
        <span className="truncate">label</span>
      </TruncatingRow>
    )
    expect(slot(container, 'truncating-row')!).toHaveClass('flex', 'min-w-0', 'items-center')
    expect(slot(container, 'truncating-row-content')!).toHaveClass('min-w-0', 'flex-1')
    expect(slot(container, 'truncating-row-leading')!).toHaveClass('shrink-0')
    expect(slot(container, 'truncating-row-trailing')!).toHaveClass('shrink-0')
  })

  it('omits slots that are not provided', () => {
    const { container } = render(
      <TruncatingRow>
        <span>label</span>
      </TruncatingRow>
    )
    expect(slot(container, 'truncating-row-leading')).toBeNull()
    expect(slot(container, 'truncating-row-trailing')).toBeNull()
  })
})

describe('PageShell', () => {
  it('is a min-h-0 fill column with overflow-hidden by default', () => {
    const { container } = render(<PageShell />)
    expect(slot(container, 'page-shell')!).toHaveClass('flex', 'flex-col', 'min-h-0', 'flex-1', 'overflow-hidden')
  })

  it('switches to overflow-y-auto when scroll', () => {
    const { container } = render(<PageShell scroll />)
    const el = slot(container, 'page-shell')!
    expect(el).toHaveClass('overflow-y-auto')
    expect(el).not.toHaveClass('overflow-hidden')
  })
})

describe('Container', () => {
  it('applies padded outer and a centered max-w-3xl inner for settings', () => {
    const { container } = render(<Container size="settings">content</Container>)
    expect(slot(container, 'container')!).toHaveClass('px-6', 'py-4')
    expect(slot(container, 'container-inner')!).toHaveClass('mx-auto', 'w-full', 'max-w-3xl')
  })

  it('uses max-w-5xl for gallery and drops the cap when fluid', () => {
    const { container: gallery } = render(<Container size="gallery">x</Container>)
    expect(slot(gallery, 'container-inner')!).toHaveClass('max-w-5xl')
    const { container: fluid } = render(<Container fluid>x</Container>)
    const inner = slot(fluid, 'container-inner')!
    expect(inner).not.toHaveClass('max-w-3xl')
    expect(inner).not.toHaveClass('max-w-5xl')
  })
})

describe('Spacer', () => {
  it('is a flex-1 filler', () => {
    const { container } = render(<Spacer />)
    expect(slot(container, 'spacer')!).toHaveClass('flex-1')
  })
})

describe('deprecated presets stay back-compatible and inherit gap', () => {
  it('RowFlex is a row, ColFlex a column, SpaceBetweenRowFlex a between-row', () => {
    const { container } = render(
      <>
        <RowFlex gap={2} />
        <ColFlex gap={2} />
        <SpaceBetweenRowFlex gap={2} />
      </>
    )
    expect(slot(container, 'row-flex')!).toHaveClass('flex', 'flex-row', 'gap-2')
    expect(slot(container, 'col-flex')!).toHaveClass('flex', 'flex-col', 'gap-2')
    expect(slot(container, 'space-between-row-flex')!).toHaveClass('flex', 'flex-row', 'justify-between', 'gap-2')
  })
})
