import { CURRENCY, type Model } from '@shared/data/types/model'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import EditModelDrawer from '../EditModelDrawer'

const useProviderMock = vi.fn()
const updateModelMock = vi.fn()

const { ipcRequest } = vi.hoisted(() => ({ ipcRequest: vi.fn() }))
vi.mock('@renderer/ipc', () => ({ ipcApi: { request: ipcRequest }, useIpcOn: vi.fn() }))

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn()
  HTMLElement.prototype.hasPointerCapture ??= () => false
  HTMLElement.prototype.releasePointerCapture ??= () => {}
  HTMLElement.prototype.setPointerCapture ??= () => {}
})

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<object>()
  return {
    ...actual,
    useTranslation: () => ({ t: (key: string) => key })
  }
})

vi.mock('@cherrystudio/ui', async (importOriginal) => {
  const actual = await importOriginal<object>()
  return {
    ...actual,
    Button: ({ children, loading, type = 'button', ...props }: any) => (
      <button {...props} type={type} disabled={props.disabled || loading}>
        {children}
      </button>
    ),
    Switch: ({ checked, onCheckedChange, ...props }: any) => (
      <button type="button" role="switch" aria-checked={checked} onClick={() => onCheckedChange(!checked)} {...props}>
        {String(checked)}
      </button>
    ),
    Tooltip: ({ children, content }: any) => <span aria-label={content}>{children}</span>,
    WarnTooltip: () => <span>warn</span>
  }
})

vi.mock('@renderer/services/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@renderer/hooks/useProvider', () => ({ useProvider: (...args: any[]) => useProviderMock(...args) }))
vi.mock('@renderer/hooks/useModel', () => ({
  useModelMutations: () => ({ updateModel: (...args: any[]) => updateModelMock(...args) })
}))
vi.mock('@renderer/components/icons/CopyIcon', () => ({ default: () => <span>copy-icon</span> }))

function makeModel(overrides: Partial<Model> = {}): Model {
  return {
    id: 'openai::claude-4-sonnet',
    providerId: 'openai',
    name: 'Claude 4 Sonnet',
    group: 'Anthropic',
    capabilities: [],
    supportsStreaming: true,
    pricing: {
      input: { perMillionTokens: 3, currency: CURRENCY.USD },
      output: { perMillionTokens: 15, currency: CURRENCY.USD }
    },
    ...overrides
  } as Model
}

describe('EditModelDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ipcRequest.mockResolvedValue(undefined)
    updateModelMock.mockResolvedValue(undefined)
    useProviderMock.mockReturnValue({ provider: { id: 'openai', name: 'OpenAI' } })
  })

  it('discards edits when the user cancels', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<EditModelDrawer providerId="openai" open onClose={onClose} model={makeModel()} />)

    const nameInput = screen.getByLabelText('settings.models.add.model_name.label')
    await user.clear(nameInput)
    await user.type(nameInput, 'Renamed model')
    await user.click(screen.getByRole('button', { name: 'common.cancel' }))

    expect(updateModelMock).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('saves cross-section edits atomically, including a visual time rule', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<EditModelDrawer providerId="openai" open onClose={onClose} model={makeModel()} />)

    const nameInput = screen.getByLabelText('settings.models.add.model_name.label')
    await user.clear(nameInput)
    await user.type(nameInput, 'Renamed model')
    await user.click(screen.getByRole('button', { name: 'models.price.title' }))
    await user.click(screen.getByRole('tab', { name: 'models.price.rule.title' }))
    await user.click(screen.getByRole('button', { name: 'models.price.schedule.add_rule' }))
    await user.click(screen.getByRole('button', { name: 'models.price.rule.time_template' }))
    await user.click(screen.getByRole('combobox', { name: 'models.price.rule.add_condition' }))
    await user.click(screen.getByRole('option', { name: 'models.price.rule.tier_template' }))

    const ruleInputPrice = screen.getAllByLabelText('models.price.input').at(-1)!
    await user.type(ruleInputPrice, '1.5')
    await user.click(screen.getByRole('tab', { name: 'models.price.base_title' }))
    await user.click(screen.getByRole('tab', { name: 'settings.general.title' }))
    await user.click(screen.getByRole('button', { name: 'models.price.title' }))
    await user.click(screen.getByRole('tab', { name: 'models.price.rule.title' }))
    expect(ruleInputPrice).toHaveValue('1.5')
    await user.click(screen.getByRole('button', { name: 'common.save' }))

    await waitFor(() => expect(updateModelMock).toHaveBeenCalledTimes(1))
    expect(updateModelMock).toHaveBeenCalledWith(
      'openai',
      'claude-4-sonnet',
      expect.objectContaining({
        name: 'Renamed model',
        pricing: expect.objectContaining({
          rules: [
            expect.objectContaining({
              when: expect.objectContaining({
                minInputTokens: 100000,
                time: expect.objectContaining({
                  cron: ['* 9-16 * * 1,2,3,4,5']
                })
              }),
              pricing: expect.objectContaining({
                input: { perMillionTokens: 1.5, currency: CURRENCY.USD }
              })
            })
          ]
        })
      })
    )
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('blocks saving a rule without a price override', async () => {
    const user = userEvent.setup()
    render(<EditModelDrawer providerId="openai" open onClose={vi.fn()} model={makeModel()} />)

    await user.click(screen.getByRole('button', { name: 'models.price.title' }))
    await user.click(screen.getByRole('tab', { name: 'models.price.rule.title' }))
    await user.click(screen.getByRole('button', { name: 'models.price.schedule.add_rule' }))
    await user.click(screen.getByRole('button', { name: 'models.price.rule.time_template' }))
    await user.click(screen.getByRole('button', { name: 'common.save' }))

    expect(updateModelMock).not.toHaveBeenCalled()
    expect(screen.getByText('models.price.rule.validation')).toBeInTheDocument()
  })

  it('clears a user pricing override only after Save is confirmed', async () => {
    const user = userEvent.setup()
    render(
      <EditModelDrawer
        providerId="openai"
        open
        onClose={vi.fn()}
        model={makeModel({ presetModelId: 'claude-4-sonnet', pricingSource: 'user' })}
      />
    )

    await user.click(screen.getByRole('button', { name: 'models.price.title' }))
    await user.click(screen.getByRole('button', { name: 'models.price.restore_provider' }))
    expect(updateModelMock).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'common.save' }))
    await waitFor(() => expect(updateModelMock).toHaveBeenCalledTimes(1))
    expect(updateModelMock.mock.calls[0][2]).toEqual(expect.objectContaining({ pricing: null }))
  })

  it('keeps the dialog open and reports a save failure', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    updateModelMock.mockRejectedValue(new Error('save failed'))
    render(<EditModelDrawer providerId="openai" open onClose={onClose} model={makeModel()} />)

    await user.click(screen.getByRole('button', { name: 'common.save' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('settings.models.manage.operation_failed')
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})
