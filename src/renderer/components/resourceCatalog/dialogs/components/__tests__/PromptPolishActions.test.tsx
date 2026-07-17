import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  fetchGenerate: vi.fn(),
  loggerError: vi.fn(),
  toastError: vi.fn()
}))

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
  useTranslation: () => ({ t: (key: string) => key })
}))

import { PromptPolishActions } from '../PromptPolishActions'

function Harness({
  initialValue = 'Draft {{date}} for ${city}',
  fallbackSource
}: {
  initialValue?: string
  fallbackSource?: string
}) {
  const [value, setValue] = useState(initialValue)

  return (
    <>
      <PromptPolishActions value={value} fallbackSource={fallbackSource} onChange={setValue} />
      <button type="button" onClick={() => setValue('Manual edit')}>
        manual edit
      </button>
      <button type="button" onClick={() => setValue('Polished prompt')}>
        restore polished value
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
  it('polishes through the default-model generation path and supports one-step undo', async () => {
    mocks.fetchGenerate.mockResolvedValueOnce('Polished {{date}} for ${city}')
    render(<Harness />)

    fireEvent.click(screen.getByRole('button', { name: 'library.config.prompt.polish' }))

    await waitFor(() => expect(screen.getByTestId('value')).toHaveTextContent('Polished {{date}} for ${city}'))
    expect(mocks.fetchGenerate).toHaveBeenCalledWith({
      prompt: expect.stringContaining('Improve the supplied prompt without changing its intent or behavior.'),
      content: 'Draft {{date}} for ${city}',
      throwOnError: true
    })
    expect(mocks.fetchGenerate.mock.calls[0][0].prompt).not.toContain(
      'Create a useful system prompt from the supplied name or title.'
    )

    fireEvent.click(screen.getByRole('button', { name: 'common.undo' }))
    expect(screen.getByTestId('value')).toHaveTextContent('Draft {{date}} for ${city}')
  })

  it('keeps the action visible but disabled when both prompt and fallback source are blank', () => {
    render(<Harness initialValue="   " />)

    expect(screen.getByRole('button', { name: 'library.config.prompt.polish' })).toBeDisabled()
    expect(mocks.fetchGenerate).not.toHaveBeenCalled()
  })

  it('generates from the fallback source for a blank prompt and restores the blank prompt on undo', async () => {
    mocks.fetchGenerate.mockResolvedValueOnce('Generated agent instructions')
    render(<Harness initialValue="" fallbackSource="Alpha Agent" />)

    const polishButton = screen.getByRole('button', { name: 'library.config.prompt.polish' })
    expect(polishButton).toBeEnabled()
    fireEvent.click(polishButton)

    await waitFor(() => expect(screen.getByTestId('value')).toHaveTextContent('Generated agent instructions'))
    expect(mocks.fetchGenerate).toHaveBeenCalledWith({
      prompt: expect.stringContaining('Create a useful system prompt from the supplied name or title.'),
      content: 'Alpha Agent',
      throwOnError: true
    })
    expect(mocks.fetchGenerate.mock.calls[0][0].prompt).not.toContain(
      'Improve the supplied prompt without changing its intent or behavior.'
    )

    fireEvent.click(screen.getByRole('button', { name: 'common.undo' }))
    expect(screen.getByTestId('value')).toBeEmptyDOMElement()
  })

  it('polishes a short non-empty prompt instead of treating it as a title', async () => {
    mocks.fetchGenerate.mockResolvedValueOnce('回答务必简洁、清晰。')
    render(<Harness initialValue="回答要简洁" fallbackSource="Concise assistant" />)

    fireEvent.click(screen.getByRole('button', { name: 'library.config.prompt.polish' }))

    await waitFor(() => expect(screen.getByTestId('value')).toHaveTextContent('回答务必简洁、清晰。'))
    expect(mocks.fetchGenerate).toHaveBeenCalledWith({
      prompt: expect.stringContaining('Improve the supplied prompt without changing its intent or behavior.'),
      content: '回答要简洁',
      throwOnError: true
    })
    expect(mocks.fetchGenerate.mock.calls[0][0].prompt).not.toContain(
      'Create a useful system prompt from the supplied name or title.'
    )
  })

  it('matches the assistant circular action style', () => {
    render(<Harness />)

    const polishButton = screen.getByRole('button', { name: 'library.config.prompt.polish' })
    expect(polishButton).toHaveClass('rounded-full')
    expect(polishButton).not.toHaveClass('rounded-2xs')
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

  it('reports polishing state to the owning flow', async () => {
    const request = deferredResponse()
    mocks.fetchGenerate.mockReturnValue(request.promise)
    const onPolishingChange = vi.fn()
    render(<PromptPolishActions value="Original prompt" onChange={vi.fn()} onPolishingChange={onPolishingChange} />)

    fireEvent.click(screen.getByRole('button', { name: 'library.config.prompt.polish' }))
    expect(onPolishingChange).toHaveBeenCalledWith(true)

    await act(async () => request.resolve('Polished prompt'))
    expect(onPolishingChange).toHaveBeenLastCalledWith(false)
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

  it('does not create undo state when the polished result is unchanged', async () => {
    mocks.fetchGenerate.mockResolvedValueOnce('Original prompt')
    const onChange = vi.fn()
    render(<PromptPolishActions value="Original prompt" onChange={onChange} />)

    fireEvent.click(screen.getByRole('button', { name: 'library.config.prompt.polish' }))
    await waitFor(() => expect(mocks.fetchGenerate).toHaveBeenCalledTimes(1))

    expect(onChange).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'common.undo' })).not.toBeInTheDocument()
  })

  it('ignores a late response after unmount', async () => {
    const request = deferredResponse()
    mocks.fetchGenerate.mockReturnValueOnce(request.promise)
    const onChange = vi.fn()
    const onPolishingChange = vi.fn()
    const view = render(
      <PromptPolishActions value="Original prompt" onChange={onChange} onPolishingChange={onPolishingChange} />
    )

    fireEvent.click(screen.getByRole('button', { name: 'library.config.prompt.polish' }))
    expect(onPolishingChange).toHaveBeenCalledWith(true)
    view.unmount()
    expect(onPolishingChange).toHaveBeenLastCalledWith(false)
    await act(async () => request.resolve('Late polished prompt'))

    expect(onChange).not.toHaveBeenCalled()
  })

  it('does not overwrite a manual edit made while polishing', async () => {
    const request = deferredResponse()
    mocks.fetchGenerate.mockReturnValueOnce(request.promise)
    const onChange = vi.fn()
    const view = render(<PromptPolishActions value="Original prompt" onChange={onChange} />)

    fireEvent.click(screen.getByRole('button', { name: 'library.config.prompt.polish' }))
    view.rerender(<PromptPolishActions value="Manual edit" onChange={onChange} />)
    await act(async () => request.resolve('Late polished prompt'))

    expect(onChange).not.toHaveBeenCalled()
  })

  it('does not apply a fallback response after the fallback source changes', async () => {
    const request = deferredResponse()
    mocks.fetchGenerate.mockReturnValueOnce(request.promise)
    const onChange = vi.fn()
    const view = render(<PromptPolishActions value="" fallbackSource="Alpha Agent" onChange={onChange} />)

    fireEvent.click(screen.getByRole('button', { name: 'library.config.prompt.polish' }))
    view.rerender(<PromptPolishActions value="" fallbackSource="Beta Agent" onChange={onChange} />)
    await act(async () => request.resolve('Generated Alpha instructions'))

    expect(onChange).not.toHaveBeenCalled()
  })

  it('does not apply a response after the action becomes disabled', async () => {
    const request = deferredResponse()
    mocks.fetchGenerate.mockReturnValueOnce(request.promise)
    const onChange = vi.fn()
    const view = render(<PromptPolishActions value="Original prompt" onChange={onChange} />)

    fireEvent.click(screen.getByRole('button', { name: 'library.config.prompt.polish' }))
    view.rerender(<PromptPolishActions value="Original prompt" onChange={onChange} disabled />)
    await act(async () => request.resolve('Late polished prompt'))

    expect(onChange).not.toHaveBeenCalled()
  })

  it('invalidates undo after a manual edit', async () => {
    mocks.fetchGenerate.mockResolvedValueOnce('Polished prompt')
    render(<Harness initialValue="Original prompt" />)

    fireEvent.click(screen.getByRole('button', { name: 'library.config.prompt.polish' }))
    await screen.findByRole('button', { name: 'common.undo' })
    fireEvent.click(screen.getByRole('button', { name: 'manual edit' }))

    expect(screen.queryByRole('button', { name: 'common.undo' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'restore polished value' }))
    expect(screen.queryByRole('button', { name: 'common.undo' })).not.toBeInTheDocument()
  })
})
