// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { render, screen } from '@testing-library/react'
import type { CSSProperties } from 'react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@cherrystudio/ui/icons', () => {
  const BrandIcon = ({ style }: { style?: CSSProperties }) => <svg data-testid="provider-brand-icon" style={style} />

  return {
    resolveProviderIconRef: (id: string) => ({ kind: 'provider', key: id, meta: { id, colorPrimary: '#000' } }),
    useIcon: () => BrandIcon
  }
})

import { ProviderAvatar } from '../ProviderAvatar'

describe('ProviderAvatar display context', () => {
  it('enlarges regular provider-list icons without flex shrinking them back to the container size', () => {
    render(<ProviderAvatar provider={{ id: 'openai', name: 'OpenAI' }} size={26} displayContext="provider-list" />)

    expect(screen.getByTestId('provider-brand-icon')).toHaveStyle({
      width: '120%',
      height: '120%',
      flexShrink: 0
    })
  })

  it('keeps contained provider-list icons on their smaller configured scale', () => {
    render(<ProviderAvatar provider={{ id: 'aihubmix', name: 'AiHubMix' }} size={26} displayContext="provider-list" />)

    expect(screen.getByTestId('provider-brand-icon')).toHaveStyle({
      width: '71.42857142857143%',
      height: '71.42857142857143%',
      flexShrink: 0,
      borderRadius: '5px'
    })
  })
})
