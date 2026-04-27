import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ApiActions from '../ApiActions'

const useProviderMetaMock = vi.fn()

vi.mock('@cherrystudio/ui', async (importOriginal) => {
  const actual = await importOriginal<any>()

  return {
    ...actual,
    Button: ({ children, onClick, ...props }: any) => (
      <button type="button" onClick={onClick} {...props}>
        {children}
      </button>
    )
  }
})

vi.mock('../../hooks/providerSetting/useProviderMeta', () => ({
  useProviderMeta: (...args: any[]) => useProviderMetaMock(...args)
}))

describe('ApiActions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useProviderMetaMock.mockReturnValue({
      isApiKeyFieldVisible: true
    })
  })

  it('owns the api key list action locally by providerId', () => {
    const openApiKeyList = vi.fn()

    render(<ApiActions providerId="openai" onOpenApiKeyList={openApiKeyList} />)

    expect(useProviderMetaMock).toHaveBeenCalledWith('openai')

    fireEvent.click(screen.getByRole('button', { name: /API 密钥管理/i }))
    expect(openApiKeyList).toHaveBeenCalled()
  })

  it('hides the api key list button when the field is not visible', () => {
    useProviderMetaMock.mockReturnValue({
      isApiKeyFieldVisible: false
    })

    const { container } = render(<ApiActions providerId="copilot" onOpenApiKeyList={vi.fn()} />)

    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByRole('button', { name: /API 密钥管理/i })).not.toBeInTheDocument()
  })
})
