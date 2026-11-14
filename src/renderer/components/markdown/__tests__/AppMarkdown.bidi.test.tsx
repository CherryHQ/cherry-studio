import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type * as CherryStudioUi from '@cherrystudio/ui'
import { rehypeTextDirection } from '@renderer/components/chat/messages/markdown/plugins/rehypeTextDirection'
import { CodeStyleProvider } from '@renderer/components/CodeStyleProvider'

import { AppMarkdown } from '../AppMarkdown'
import { MarkdownHostProvider } from '../MarkdownHostProvider'

vi.mock('@cherrystudio/ui', async (importOriginal) => importOriginal<typeof CherryStudioUi>())
vi.mock('react-i18next', () => {
  const t = (key: string) => key
  return { useTranslation: () => ({ t }) }
})

describe('AppMarkdown with rehypeTextDirection', () => {
  it('marks Arabic-dominant prose as rtl even when it starts with a Latin word', () => {
    const { container } = render(
      <MarkdownHostProvider>
        <AppMarkdown id="rtl-case" rehypePlugins={[rehypeTextDirection]}>
          React هي مكتبة لبناء واجهات المستخدم
        </AppMarkdown>
      </MarkdownHostProvider>
    )
    expect(container.querySelector('p')).toHaveAttribute('dir', 'rtl')
  })

  it('marks English-dominant prose as ltr even when it contains an Arabic word', () => {
    const { container } = render(
      <MarkdownHostProvider>
        <AppMarkdown id="ltr-case" rehypePlugins={[rehypeTextDirection]}>
          The Arabic label is مرحبا, and this paragraph is English.
        </AppMarkdown>
      </MarkdownHostProvider>
    )
    expect(container.querySelector('p')).toHaveAttribute('dir', 'ltr')
  })

  it('leaves code blocks without a direction', () => {
    const { container } = render(
      <CodeStyleProvider>
        <MarkdownHostProvider>
          <AppMarkdown id="code-case" rehypePlugins={[rehypeTextDirection]}>
            {'```js\nconst x = 1\n```'}
          </AppMarkdown>
        </MarkdownHostProvider>
      </CodeStyleProvider>
    )
    expect(container.querySelector('pre')).not.toHaveAttribute('dir')
  })
})
