import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))
vi.mock('@renderer/components/CodeViewer', () => ({
  default: ({ value }: { value: string }) => <pre>{value}</pre>
}))
vi.mock('../../shared/GenericTools', () => ({
  SkeletonValue: ({ value }: { value: ReactNode }) => <>{value}</>,
  ToolHeader: () => <div />,
  TruncatedIndicator: () => null
}))

import { ReadTool } from '../ReadTool'

const image = {
  type: 'image',
  source: {
    type: 'base64',
    media_type: 'image/png',
    data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg=='
  }
}

function Harness({ output, hasError = false }: { output?: unknown; hasError?: boolean }) {
  const item = ReadTool({ output: output as never, hasError })
  return (
    <>
      {item.label}
      {item.children}
    </>
  )
}

describe('ReadTool', () => {
  it('previews native base64 image results from a saved session message', () => {
    const savedOutput = JSON.parse(JSON.stringify([image]))
    render(<Harness output={savedOutput} />)

    expect(screen.getByRole('img', { name: 'message.tools.sections.output' })).toHaveAttribute(
      'src',
      `data:image/png;base64,${image.source.data}`
    )
  })

  it('previews the SDK Read image output shape', () => {
    render(
      <Harness
        output={{
          type: 'image',
          file: { base64: image.source.data, type: 'image/png', originalSize: 70 }
        }}
      />
    )

    expect(screen.getByRole('img', { name: 'message.tools.sections.output' })).toHaveAttribute(
      'src',
      `data:image/png;base64,${image.source.data}`
    )
  })

  it('shows image previews alongside text in a mixed native result', () => {
    render(
      <Harness output={[{ type: 'text', text: 'Image details' }, image, { type: 'text', text: 'Additional notes' }]} />
    )

    expect(screen.getByText('Image detailsAdditional notes')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'message.tools.sections.output' })).toBeInTheDocument()
  })

  it('keeps ordinary text results readable without an image preview', () => {
    render(<Harness output={[{ type: 'text', text: 'Plain text result' }]} />)

    expect(screen.getByText('Plain text result')).toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('keeps error results readable without rendering image content', () => {
    render(
      <Harness
        hasError
        output={{
          isError: true,
          content: [{ type: 'text', text: 'Unable to read the requested file' }]
        }}
      />
    )

    expect(screen.getByText('Unable to read the requested file')).toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })
})
