import { render, screen } from '@testing-library/react'
import type { PropsWithChildren, ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import ModelList from '../ModelList'

vi.mock('@cherrystudio/ui', () => ({
  ButtonGroup: ({ children }: PropsWithChildren) => <div>{children}</div>
}))

vi.mock('../modelListHealthContext', () => ({
  useModelListHealthRun: () => ({ isHealthChecking: false })
}))

vi.mock('../ProviderModelList', () => ({
  default: ({ actions }: { actions: (props: { disabled: boolean }) => ReactNode }) => (
    <>{actions({ disabled: false })}</>
  )
}))

vi.mock('../ProviderModelPullReconcile', () => ({
  default: () => <button type="button">pull-models</button>
}))

vi.mock('../ProviderModelAdd', () => ({
  default: () => <button type="button">add-model</button>
}))

vi.mock('../ProviderModelDownload', () => ({
  default: () => <button type="button">download-model</button>
}))

vi.mock('../ProviderModelHealthCheck', () => ({
  default: () => null
}))

describe('ModelList toolbar', () => {
  it('hides manual model addition when the page disables it', () => {
    render(<ModelList providerId="cherryin" allowManualModelAdd={false} />)

    expect(screen.queryByRole('button', { name: 'add-model' })).not.toBeInTheDocument()
  })

  it('keeps manual model addition enabled by default', () => {
    render(<ModelList providerId="openai" />)

    expect(screen.getByRole('button', { name: 'add-model' })).toBeInTheDocument()
  })
})
