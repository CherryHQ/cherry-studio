import type * as CherryStudioUi from '@cherrystudio/ui'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { startTransition, Suspense, useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  fetchGenerate: vi.fn(),
  loggerError: vi.fn(),
  toastError: vi.fn()
}))

vi.mock('@cherrystudio/ui', async (importOriginal) => {
  return importOriginal<typeof CherryStudioUi>()
})

vi.mock('@logger', () => ({
  loggerService: { withContext: () => ({ error: mocks.loggerError }) }
}))

vi.mock('@renderer/services/toast', () => ({
  toast: { error: mocks.toastError }
}))

vi.mock('@renderer/utils/aiGeneration', () => ({
  fetchGenerate: mocks.fetchGenerate
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => (key === 'common.undo' ? 'Undo' : key) })
}))

import { PromptPolishActions } from '../PromptPolishActions'

const TEST_GENERATE_SYSTEM_PROMPT = 'Generate a test prompt from the supplied title.'
const TEST_EXISTING_SYSTEM_PROMPT = 'Rewrite an existing test prompt as a structured persona.'
const NEVER_RESOLVING_PROMISE = new Promise<never>(() => undefined)

function SuspendWhen({ active }: { active: boolean }) {
  if (active) {
    throw NEVER_RESOLVING_PROMISE
  }

  return null
}

function Harness({
  initialValue = 'Draft {{date}} for ${city}',
  fallbackSource: initialFallbackSource,
  onChangeSpy
}: {
  initialValue?: string
  fallbackSource?: string
  onChangeSpy?: (value: string) => void
}) {
  const [value, setValue] = useState(initialValue)
  const [fallbackSource, setFallbackSource] = useState(initialFallbackSource)
  const [disabled, setDisabled] = useState(false)

  const handleChange = (nextValue: string) => {
    onChangeSpy?.(nextValue)
    setValue(nextValue)
  }

  return (
    <>
      <PromptPolishActions
        value={value}
        fallbackSource={fallbackSource}
        emptyValueSystemPrompt={TEST_GENERATE_SYSTEM_PROMPT}
        existingValueSystemPrompt={TEST_EXISTING_SYSTEM_PROMPT}
        onChange={handleChange}
        disabled={disabled}
      />
      <button type="button" onClick={() => setValue('Manual edit')}>
        manual edit
      </button>
      <button type="button" onClick={() => setValue('Polished prompt')}>
        restore polished value
      </button>
      <button type="button" onClick={() => setFallbackSource('Beta Agent')}>
        change fallback source
      </button>
      <button type="button" onClick={() => setDisabled(true)}>
        disable action
      </button>
      <output data-testid="value">{value}</output>
    </>
  )
}

function deferredResponse() {
  let resolve: (value: string) => void = () => undefined
  const promise = new Promise<string>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

beforeEach(() => {
  mocks.fetchGenerate.mockReset()
  mocks.loggerError.mockReset()
  mocks.toastError.mockReset()
})

describe('PromptPolishActions', () => {
  it('rewrites an existing prompt with the caller-provided strategy and supports one-step undo', async () => {
    mocks.fetchGenerate.mockResolvedValueOnce('Polished {{date}} for ${city}')
    render(<Harness />)

    const polishButton = screen.getByRole('button', { name: 'library.config.prompt.polish' })
    fireEvent.click(polishButton)

    await waitFor(() => expect(screen.getByTestId('value')).toHaveTextContent('Polished {{date}} for ${city}'))
    expect(mocks.fetchGenerate).toHaveBeenCalledWith({
      prompt: TEST_EXISTING_SYSTEM_PROMPT,
      content: 'Draft {{date}} for ${city}',
      throwOnError: true
    })

    const undoButton = screen.getByRole('button', { name: 'Undo' })
    fireEvent.click(undoButton)
    expect(screen.getByTestId('value')).toHaveTextContent('Draft {{date}} for ${city}')
  })

  it('does not start generation without a source', () => {
    render(<Harness initialValue="   " />)

    const generateButton = screen.getByRole('button', { name: 'library.config.prompt.generate' })
    expect(generateButton).toHaveAttribute('aria-disabled', 'true')
    expect(generateButton).not.toBeDisabled()
    fireEvent.click(generateButton)
    expect(mocks.fetchGenerate).not.toHaveBeenCalled()
  })

  it('generates from the fallback source for a blank prompt and restores the blank prompt on undo', async () => {
    mocks.fetchGenerate.mockResolvedValueOnce('Generated agent instructions')
    render(<Harness initialValue="" fallbackSource="Alpha Agent" />)

    const generateButton = screen.getByRole('button', { name: 'library.config.prompt.generate' })
    expect(generateButton).toBeEnabled()
    fireEvent.click(generateButton)

    await waitFor(() => expect(screen.getByTestId('value')).toHaveTextContent('Generated agent instructions'))
    const polishButton = screen.getByRole('button', { name: 'library.config.prompt.polish' })
    expect(polishButton).toBeInTheDocument()
    expect(mocks.fetchGenerate).toHaveBeenCalledWith({
      prompt: TEST_GENERATE_SYSTEM_PROMPT,
      content: 'Alpha Agent',
      throwOnError: true
    })

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(screen.getByTestId('value')).toBeEmptyDOMElement()
  })

  it('does not start a duplicate request while polishing is in flight', async () => {
    const request = deferredResponse()
    mocks.fetchGenerate.mockReturnValue(request.promise)
    render(<Harness initialValue="Original prompt" />)

    const polishButton = screen.getByRole('button', { name: 'library.config.prompt.polish' })
    fireEvent.click(polishButton)
    fireEvent.click(polishButton)
    await act(async () => request.resolve('Polished prompt'))

    expect(mocks.fetchGenerate).toHaveBeenCalledTimes(1)
  })

  it('rejects a result that changes duplicate protected placeholders', async () => {
    mocks.fetchGenerate.mockResolvedValueOnce('Polished {{date}} for ${city}')
    render(<Harness initialValue="Draft {{date}} and {{date}} for ${city}" />)

    fireEvent.click(screen.getByRole('button', { name: 'library.config.prompt.polish' }))

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith({
        title: 'library.config.prompt.polish_variables_changed_title',
        description: 'library.config.prompt.polish_variables_changed_description'
      })
    )
    expect(screen.getByTestId('value')).toHaveTextContent('Draft {{date}} and {{date}} for ${city}')
  })

  it('keeps the original value when generation returns an empty result', async () => {
    mocks.fetchGenerate.mockResolvedValueOnce('')
    render(<Harness initialValue="Original prompt" />)

    fireEvent.click(screen.getByRole('button', { name: 'library.config.prompt.polish' }))

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith({
        title: 'library.config.prompt.polish_failed_title',
        description: 'library.config.prompt.polish_failed_description'
      })
    )
    expect(screen.getByTestId('value')).toHaveTextContent('Original prompt')
  })

  it('keeps the original value and reports a request error', async () => {
    mocks.fetchGenerate.mockRejectedValueOnce(new Error('model failed'))
    render(<Harness initialValue="Original prompt" />)

    fireEvent.click(screen.getByRole('button', { name: 'library.config.prompt.polish' }))

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith({
        title: 'library.config.prompt.polish_failed_title',
        description: 'library.config.prompt.polish_failed_description'
      })
    )
    expect(mocks.loggerError).toHaveBeenCalledWith('Failed to polish prompt', expect.any(Error))
    expect(screen.getByTestId('value')).toHaveTextContent('Original prompt')
  })

  it('uses the generation failure toast for a fallback request', async () => {
    mocks.fetchGenerate.mockRejectedValueOnce(new Error('model failed'))
    render(<Harness initialValue="" fallbackSource="Alpha Agent" />)

    fireEvent.click(screen.getByRole('button', { name: 'library.config.prompt.generate' }))

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith({
        title: 'library.config.prompt.generate_failed_title',
        description: 'library.config.prompt.generate_failed_description'
      })
    )
    expect(screen.getByTestId('value')).toBeEmptyDOMElement()
  })

  it('does not create undo state when the polished result is unchanged', async () => {
    mocks.fetchGenerate.mockResolvedValueOnce('Original prompt')
    const onChange = vi.fn()
    render(<Harness initialValue="Original prompt" onChangeSpy={onChange} />)

    fireEvent.click(screen.getByRole('button', { name: 'library.config.prompt.polish' }))
    await waitFor(() => expect(mocks.fetchGenerate).toHaveBeenCalledTimes(1))

    expect(onChange).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument()
  })

  it('ignores a late response after unmount', async () => {
    const request = deferredResponse()
    mocks.fetchGenerate.mockReturnValueOnce(request.promise)
    const onChange = vi.fn()
    const view = render(<Harness initialValue="Original prompt" onChangeSpy={onChange} />)

    fireEvent.click(screen.getByRole('button', { name: 'library.config.prompt.polish' }))
    view.unmount()
    await act(async () => request.resolve('Late polished prompt'))

    expect(onChange).not.toHaveBeenCalled()
  })

  it('does not overwrite a manual edit made while polishing', async () => {
    const request = deferredResponse()
    mocks.fetchGenerate.mockReturnValueOnce(request.promise)
    const onChange = vi.fn()
    render(<Harness initialValue="Original prompt" onChangeSpy={onChange} />)

    fireEvent.click(screen.getByRole('button', { name: 'library.config.prompt.polish' }))
    fireEvent.click(screen.getByRole('button', { name: 'manual edit' }))
    await act(async () => request.resolve('Late polished prompt'))

    expect(onChange).not.toHaveBeenCalled()
  })

  it('uses only committed props after an interrupted render', async () => {
    const request = deferredResponse()
    mocks.fetchGenerate.mockReturnValueOnce(request.promise)
    const onChange = vi.fn()

    function ConcurrentHarness() {
      const [value, setValue] = useState('Original prompt')
      const [suspended, setSuspended] = useState(false)

      return (
        <Suspense fallback={null}>
          <PromptPolishActions
            value={value}
            emptyValueSystemPrompt={TEST_GENERATE_SYSTEM_PROMPT}
            existingValueSystemPrompt={TEST_EXISTING_SYSTEM_PROMPT}
            onChange={onChange}
          />
          <button
            type="button"
            onClick={() => {
              startTransition(() => {
                setValue('Uncommitted prompt')
                setSuspended(true)
              })
            }}>
            start interrupted render
          </button>
          <SuspendWhen active={suspended} />
        </Suspense>
      )
    }

    render(<ConcurrentHarness />)
    fireEvent.click(screen.getByRole('button', { name: 'library.config.prompt.polish' }))
    fireEvent.click(screen.getByRole('button', { name: 'start interrupted render' }))
    await act(async () => request.resolve('Polished prompt'))

    expect(onChange).toHaveBeenCalledWith('Polished prompt')
  })

  it('does not apply a fallback response after the fallback source changes', async () => {
    const request = deferredResponse()
    mocks.fetchGenerate.mockReturnValueOnce(request.promise)
    const onChange = vi.fn()
    render(<Harness initialValue="" fallbackSource="Alpha Agent" onChangeSpy={onChange} />)

    fireEvent.click(screen.getByRole('button', { name: 'library.config.prompt.generate' }))
    fireEvent.click(screen.getByRole('button', { name: 'change fallback source' }))
    await act(async () => request.resolve('Generated Alpha instructions'))

    expect(onChange).not.toHaveBeenCalled()
  })

  it('does not apply a response after the action becomes disabled', async () => {
    const request = deferredResponse()
    mocks.fetchGenerate.mockReturnValueOnce(request.promise)
    const onChange = vi.fn()
    render(<Harness initialValue="Original prompt" onChangeSpy={onChange} />)

    fireEvent.click(screen.getByRole('button', { name: 'library.config.prompt.polish' }))
    fireEvent.click(screen.getByRole('button', { name: 'disable action' }))
    await act(async () => request.resolve('Late polished prompt'))

    expect(onChange).not.toHaveBeenCalled()
  })

  it('invalidates undo after a manual edit', async () => {
    mocks.fetchGenerate.mockResolvedValueOnce('Polished prompt')
    render(<Harness initialValue="Original prompt" />)

    fireEvent.click(screen.getByRole('button', { name: 'library.config.prompt.polish' }))
    await screen.findByRole('button', { name: 'Undo' })
    fireEvent.click(screen.getByRole('button', { name: 'manual edit' }))

    expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'restore polished value' }))
    expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument()
  })
})
