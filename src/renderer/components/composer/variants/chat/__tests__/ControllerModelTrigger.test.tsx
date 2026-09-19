import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ControllerModelTrigger } from '../ControllerModelTrigger'

const setPreference = vi.fn()
let storedControllerId = ''
let storedModel: { id: string; name: string } | undefined

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('@data/hooks/usePreference', () => ({
  usePreference: () => [storedControllerId, setPreference]
}))

vi.mock('@renderer/hooks/useModel', () => ({
  useModelById: () => ({ model: storedModel })
}))

vi.mock('@renderer/components/Avatar/ModelAvatar', () => ({
  default: () => <span data-testid="model-avatar" />
}))

vi.mock('@renderer/components/ModelSelector', () => ({
  ModelSelector: ({ trigger, onSelect }: { trigger: ReactNode; onSelect: (model: unknown) => void }) => (
    <div>
      {trigger}
      <button type="button" onClick={() => onSelect({ id: 'openai::gpt-4o', name: 'GPT-4o' })}>
        pick
      </button>
    </div>
  )
}))

vi.mock('@cherrystudio/ui', () => ({
  Button: ({ children, ...props }: { children?: ReactNode }) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  Tooltip: ({ children }: { children?: ReactNode }) => <>{children}</>
}))

describe('ControllerModelTrigger', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    storedControllerId = ''
    storedModel = undefined
  })

  it('stays hidden with one model selected, because there is nothing to divide', () => {
    const { container } = render(<ControllerModelTrigger workerCount={1} side="top" />)

    expect(container).toBeEmptyDOMElement()
  })

  it('appears once a second model is selected', () => {
    render(<ControllerModelTrigger workerCount={2} side="top" />)

    expect(screen.getByText('chat.controller.none')).toBeInTheDocument()
  })

  it('stores the chosen coordinator by model id', () => {
    render(<ControllerModelTrigger workerCount={2} side="top" />)

    fireEvent.click(screen.getByRole('button', { name: 'pick' }))

    expect(setPreference).toHaveBeenCalledWith('openai::gpt-4o')
  })

  it('clears the coordinator without opening the picker', () => {
    storedControllerId = 'openai::gpt-4o'
    storedModel = { id: 'openai::gpt-4o', name: 'GPT-4o' }
    render(<ControllerModelTrigger workerCount={2} side="top" />)

    fireEvent.click(screen.getByRole('button', { name: 'chat.controller.clear' }))

    expect(setPreference).toHaveBeenCalledWith('')
  })

  it('names the coordinator once one is chosen', () => {
    storedControllerId = 'openai::gpt-4o'
    storedModel = { id: 'openai::gpt-4o', name: 'GPT-4o' }
    render(<ControllerModelTrigger workerCount={2} side="top" />)

    expect(screen.getByText('GPT-4o')).toBeInTheDocument()
    expect(screen.queryByText('chat.controller.none')).not.toBeInTheDocument()
  })
})
