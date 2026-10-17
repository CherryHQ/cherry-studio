import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18next from 'i18next'
import { expect, it, vi } from 'vitest'

import { CodeBlockView } from '../CodeBlockView'

vi.unmock('@cherrystudio/ui')

vi.mock('@renderer/components/CodeViewer', () => ({
  default: ({ value }: { value: string }) => <pre aria-label="Code viewer">{value}</pre>
}))
vi.mock('@renderer/hooks/useCodeStyle', () => ({ useCmTheme: () => 'light' }))
vi.mock('@renderer/services/PyodideService', () => ({ pyodideService: {} }))

it('opens an OpenUI preview and preserves its source across view changes', async () => {
  await i18next.changeLanguage('en-us')
  MockUsePreferenceUtils.resetMocks()
  MockUsePreferenceUtils.setMultiplePreferenceValues({
    'chat.code.editor.enabled': false,
    'chat.code.collapsible': false,
    'chat.code.wrappable': true,
    'chat.code.execution.enabled': false,
    'chat.message.font_size': 14
  })
  const user = userEvent.setup()
  const source = 'root = Panel("Release summary", [Text("Ready for review")])'
  render(
    <CodeBlockView language="openui" editable={false}>
      {source}
    </CodeBlockView>
  )

  expect(await screen.findByRole('heading', { name: 'Release summary' })).toBeInTheDocument()
  expect(screen.getByText('Ready for review')).toBeInTheDocument()

  await user.click(screen.getByRole('button', { name: 'View Source Code' }))
  expect(screen.getByLabelText('Code viewer').textContent).toBe(source)
  expect(screen.queryByRole('heading', { name: 'Release summary' })).not.toBeInTheDocument()

  await user.click(screen.getByRole('button', { name: 'Preview' }))
  expect(await screen.findByRole('heading', { name: 'Release summary' })).toBeInTheDocument()
})
