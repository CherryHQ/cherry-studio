import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { FileProcessorIcon } from '../FileProcessorIcon'

describe('FileProcessorIcon', () => {
  it.each(['constructor', '__proto__', 'toString'])('renders a fallback glyph for an unknown %s processor', (id) => {
    const { container } = render(<FileProcessorIcon processorId={id} />)

    expect(container.querySelector('svg')).toBeInTheDocument()
  })
})
