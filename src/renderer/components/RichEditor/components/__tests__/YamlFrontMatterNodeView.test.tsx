import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { parse } from 'yaml'

vi.unmock('@cherrystudio/ui')
vi.mock('@renderer/hooks/useCodeStyle', () => ({
  useCodeStyle: () => ({ activeCodeTheme: 'one-light' })
}))

import RichEditor from '../../RichEditor'

it('retains literal frontmatter keys and unrelated values when a property is edited', async () => {
  const changes: string[] = []
  const user = userEvent.setup()
  render(
    <RichEditor
      initialContent={'---\n__proto__: [reserved, value]\ntitle: Before\ntags: [alpha, beta]\n---\n\nBody'}
      autoFocus={false}
      onMarkdownChange={(markdown) => changes.push(markdown)}
    />
  )

  await user.click(await screen.findByRole('button', { name: /^Before$/ }))
  const input = screen.getByDisplayValue('Before')
  await user.clear(input)
  await user.type(input, 'After{Enter}')

  await waitFor(() => {
    const markdown = changes.at(-1) ?? ''
    const match = /^---\n([\s\S]*?)\n---/.exec(markdown)
    if (!match) throw new Error(`Expected edited frontmatter in Markdown output, received ${JSON.stringify(markdown)}`)
    const metadata = parse(match[1])
    expect(metadata.title).toBe('After')
    expect(Object.getOwnPropertyDescriptor(metadata, '__proto__')?.value).toEqual(['reserved', 'value'])
    expect(metadata.tags).toEqual(['alpha', 'beta'])
    expect(Object.getPrototypeOf(metadata)).toBe(Object.prototype)
    expect(markdown).toContain('Body')
  })
})
