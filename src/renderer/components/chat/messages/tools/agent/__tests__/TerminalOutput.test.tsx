import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { TerminalOutput } from '../TerminalOutput'

// Issue #20265 hardening: persisted tool parts can carry non-string terminal content (a
// JSON.parse'd bash output object, a corrupt input.command). TerminalOutput is the single
// rendering exit for those payloads, so it must normalize instead of throwing.
describe('TerminalOutput non-string content hardening', () => {
  it('renders an MCP-envelope-shaped content object as its text', () => {
    const { container } = render(
      <TerminalOutput content={{ content: [{ type: 'text', text: 'hello world' }] } as unknown as string} />
    )

    expect(container.textContent).toContain('hello world')
  })

  it('renders a text-block array content as its joined text', () => {
    const { container } = render(
      <TerminalOutput
        content={
          [
            { type: 'text', text: 'line 1' },
            { type: 'text', text: 'line 2' }
          ] as unknown as string
        }
      />
    )

    expect(container.textContent).toContain('line 1')
    expect(container.textContent).toContain('line 2')
  })

  it('renders a plain object content as serialized JSON text', () => {
    const { container } = render(<TerminalOutput content={{ exitCode: 1 } as unknown as string} />)

    expect(container.textContent).toContain('exitCode')
  })

  it.each([42, undefined, null])('renders non-string content %# without throwing', (content) => {
    const { container } = render(<TerminalOutput content={content as unknown as string} />)

    expect(container.firstChild).not.toBeNull()
  })

  it('keeps colorizing plain string command content', () => {
    const { container } = render(<TerminalOutput content="pnpm test" commandMode />)

    expect(container.textContent).toContain('pnpm test')
  })
})
