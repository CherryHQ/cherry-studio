import { render, screen } from '@testing-library/react'
import i18n from 'i18next'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import { PropertyPanel } from '../components/PropertyPanel'

const baseProps = {
  toolbarTop: 100,
  toolbarHeight: 38,
  toolbarLeft: 0,
  toolbarBelow: true,
  logicalHeight: 800,
  color: '#F54A45',
  strokeWidth: 4,
  fontSize: 20,
  onColorChange: vi.fn(),
  onStrokeWidthChange: vi.fn(),
  onFontSizeChange: vi.fn()
}

// Real translations, not a passthrough `t`: the colour labels are reached through a lookup
// table, which `i18n:check` cannot follow — so a key that does not exist would otherwise
// only ever surface as a raw `screenshot.property.…` string in the running UI.
describe('PropertyPanel accessible names', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en-US')
  })

  it('names each swatch and marks the active one, the colour being its only visual cue', () => {
    render(<PropertyPanel {...baseProps} activeTool="rect" />)

    expect(screen.getByRole('button', { name: 'Red' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Blue' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('separates the stroke widths, which are otherwise three unlabelled dots', () => {
    render(<PropertyPanel {...baseProps} activeTool="rect" />)

    expect(screen.getByRole('button', { name: 'Stroke width 2' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: 'Stroke width 4' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('separates the text sizes, which all render the same "A" glyph', () => {
    render(<PropertyPanel {...baseProps} activeTool="text" />)

    expect(screen.getByRole('button', { name: 'Text size 14' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: 'Text size 20' })).toHaveAttribute('aria-pressed', 'true')
  })
})
