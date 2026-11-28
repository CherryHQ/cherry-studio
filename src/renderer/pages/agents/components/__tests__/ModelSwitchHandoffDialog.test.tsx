import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createInstance } from 'i18next'
import { I18nextProvider, initReactI18next } from 'react-i18next'
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'

import en from '@renderer/i18n/locales/en-us.json'

import { ModelSwitchHandoffDialog } from '../ModelSwitchHandoffDialog'

vi.unmock('@cherrystudio/ui')
const ipc = vi.hoisted(() => vi.fn())
vi.mock('@renderer/ipc', () => ({ ipcApi: { request: ipc } }))
const i18n = createInstance()
const draft = {
  previousModel: 'fixture::old',
  sourceHead: 'source',
  sourceVersion: 'version',
  text: 'Generated handoff'
}
const confirm = vi.fn(async () => true)
const changed = vi.fn()
const key = (name: string) => en[`agent.session.model_switch_confirm.${name}` as keyof typeof en]
beforeAll(async () => {
  await i18n.use(initReactI18next).init({
    lng: 'en',
    resources: { en: { translation: en } },
    keySeparator: false,
    interpolation: { escapeValue: false }
  })
})
beforeEach(() => {
  ipc.mockReset()
  confirm.mockClear()
  changed.mockClear()
})
afterEach(cleanup)
function view(open = true) {
  return (
    <I18nextProvider i18n={i18n}>
      <ModelSwitchHandoffDialog
        open={open}
        sessionId="session"
        targetModelId="fixture::new"
        modelName="Next model"
        skipConfirmation={false}
        onSkipConfirmationChange={() => {}}
        onOpenChange={changed}
        onConfirm={confirm}
      />
    </I18nextProvider>
  )
}

it('switches unchecked without generation or handoff data', async () => {
  const user = userEvent.setup()
  render(view())
  expect(screen.getByRole('checkbox', { name: key('handoff_option') })).not.toBeChecked()
  await user.click(screen.getByRole('button', { name: key('confirm') }))
  expect(confirm).toHaveBeenCalledWith(undefined)
  expect(ipc).not.toHaveBeenCalled()
})

it('submits the reviewed edits rather than the generated text', async () => {
  ipc.mockResolvedValue(draft)
  const user = userEvent.setup()
  render(view())
  await user.click(screen.getByRole('checkbox', { name: key('handoff_option') }))
  expect(screen.getByRole('button', { name: key('confirm') })).toBeDisabled()
  await user.click(screen.getByRole('button', { name: key('handoff_generate') }))
  const text = await screen.findByRole('textbox', { name: key('handoff_edit') })
  await user.clear(text)
  await user.type(text, 'Edited pending work: finish export.ts')
  await user.click(screen.getByRole('button', { name: key('confirm') }))
  expect(confirm).toHaveBeenCalledWith({ ...draft, text: 'Edited pending work: finish export.ts' })
})

it('shows generation failure and still permits a switch without handoff', async () => {
  ipc.mockRejectedValueOnce(new Error('Provider unavailable'))
  const user = userEvent.setup()
  render(view())
  const option = screen.getByRole('checkbox', { name: key('handoff_option') })
  await user.click(option)
  await user.click(screen.getByRole('button', { name: key('handoff_generate') }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Provider unavailable')
  await user.click(option)
  await user.click(screen.getByRole('button', { name: key('confirm') }))
  expect(confirm).toHaveBeenCalledWith(undefined)
})

it('cancels an in-flight preview and ignores its late result without switching', async () => {
  let finish!: (value: typeof draft) => void
  ipc.mockImplementation((route: string) =>
    route === 'ai.agent.session.handoff.generate'
      ? new Promise((resolve) => {
          finish = resolve
        })
      : Promise.resolve()
  )
  const user = userEvent.setup()
  const { rerender } = render(view())
  await user.click(screen.getByRole('checkbox', { name: key('handoff_option') }))
  await user.click(screen.getByRole('button', { name: key('handoff_generate') }))
  await user.click(screen.getByRole('button', { name: en['common.cancel'] }))
  expect(changed).toHaveBeenCalledWith(false)
  rerender(view(false))
  finish(draft)
  rerender(view(true))
  await waitFor(() => expect(screen.getByRole('checkbox', { name: key('handoff_option') })).not.toBeChecked())
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  expect(confirm).not.toHaveBeenCalled()
  expect(ipc).toHaveBeenCalledWith('ai.text.abort', expect.objectContaining({ requestId: expect.any(String) }))
})
