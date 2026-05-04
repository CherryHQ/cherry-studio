import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import VertexAISettings from '../VertexAISettings'

const mockUseVertexAISettings = vi.fn()

const mockSetProjectId = vi.fn()
const mockSetLocation = vi.fn()
const mockSetServiceAccountPrivateKey = vi.fn()
const mockSetServiceAccountClientEmail = vi.fn()

vi.mock('@renderer/store', () => ({
  default: {
    getState: () => ({
      llm: {
        settings: {}
      }
    })
  }
}))

vi.mock('@renderer/hooks/useVertexAI', () => ({
  useVertexAISettings: () => mockUseVertexAISettings()
}))

vi.mock('@renderer/config/providers', () => ({
  PROVIDER_URLS: {
    vertexai: {
      websites: {
        apiKey: 'https://example.com/vertex-key'
      }
    }
  }
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  }),
  initReactI18next: {
    type: '3rdParty',
    init: vi.fn()
  }
}))

function createVertexSettings() {
  return {
    projectId: 'test-project',
    location: 'us-central1',
    serviceAccount: {
      privateKey: 'stored-private-key',
      clientEmail: 'vertex@test-project.iam.gserviceaccount.com'
    },
    setProjectId: mockSetProjectId,
    setLocation: mockSetLocation,
    setServiceAccountPrivateKey: mockSetServiceAccountPrivateKey,
    setServiceAccountClientEmail: mockSetServiceAccountClientEmail
  }
}

describe('VertexAISettings', () => {
  beforeEach(() => {
    mockSetProjectId.mockReset()
    mockSetLocation.mockReset()
    mockSetServiceAccountPrivateKey.mockReset()
    mockSetServiceAccountClientEmail.mockReset()
    mockUseVertexAISettings.mockReset()
    mockUseVertexAISettings.mockReturnValue(createVertexSettings())

    window.toast = {
      getToastQueue: vi.fn(),
      addToast: vi.fn(),
      closeToast: vi.fn(),
      closeAll: vi.fn(),
      isToastClosing: vi.fn(),
      success: vi.fn(),
      error: vi.fn(),
      warning: vi.fn(),
      info: vi.fn(),
      loading: vi.fn()
    } as typeof window.toast
  })

  it('parses a valid service account JSON payload and clears the input', async () => {
    render(<VertexAISettings />)

    const jsonTextarea = screen.getByPlaceholderText(
      'settings.provider.vertex_ai.service_account.json_input_placeholder'
    )

    fireEvent.change(jsonTextarea, {
      target: {
        value: JSON.stringify({
          project_id: 'vertex-project',
          private_key: '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n',
          client_email: 'vertex@vertex-project.iam.gserviceaccount.com'
        })
      }
    })

    await waitFor(() => {
      expect(mockSetProjectId).toHaveBeenCalledWith('vertex-project')
      expect(mockSetServiceAccountPrivateKey).toHaveBeenCalledWith(
        '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----'
      )
      expect(mockSetServiceAccountClientEmail).toHaveBeenCalledWith('vertex@vertex-project.iam.gserviceaccount.com')
      expect(jsonTextarea).toHaveValue('')
    })

    expect(window.toast.success).toHaveBeenCalledWith('settings.provider.vertex_ai.service_account.json_parse_success')
  })

  it('shows an inline error when the service account JSON is invalid', async () => {
    render(<VertexAISettings />)

    const jsonTextarea = screen.getByPlaceholderText(
      'settings.provider.vertex_ai.service_account.json_input_placeholder'
    )

    fireEvent.change(jsonTextarea, {
      target: {
        value: '{"project_id":"vertex-project"}'
      }
    })

    expect(jsonTextarea).toHaveValue('{"project_id":"vertex-project"}')
    expect(screen.getByText('settings.provider.vertex_ai.service_account.json_parse_error')).toBeInTheDocument()

    fireEvent.blur(jsonTextarea)

    await waitFor(() => {
      expect(window.toast.error).toHaveBeenCalledWith('settings.provider.vertex_ai.service_account.json_parse_error')
    })
  })

  it('marks the missing Vertex location field as invalid instead of showing a warning block', () => {
    mockUseVertexAISettings.mockReturnValue({
      ...createVertexSettings(),
      location: ''
    })

    const { container } = render(<VertexAISettings />)

    const alerts = screen.getAllByRole('alert')
    const locationInput = screen.getByRole('combobox')

    expect(alerts).toHaveLength(1)
    expect(screen.queryByText('settings.provider.vertex_ai.service_account.incomplete_config')).not.toBeInTheDocument()
    expect(locationInput.closest('.ant-select-status-error')).not.toBeNull()
    expect(container.querySelector('.ant-alert-warning')).toBeNull()
  })

  it('marks every missing required Vertex field as invalid', () => {
    mockUseVertexAISettings.mockReturnValue({
      ...createVertexSettings(),
      projectId: '',
      location: '',
      serviceAccount: {
        privateKey: '',
        clientEmail: ''
      }
    })

    render(<VertexAISettings />)

    const clientEmailInput = screen.getByPlaceholderText(
      'settings.provider.vertex_ai.service_account.client_email_placeholder'
    )
    const privateKeyTextarea = screen.getByPlaceholderText(
      'settings.provider.vertex_ai.service_account.private_key_placeholder'
    )
    const projectIdInput = screen.getByPlaceholderText('settings.provider.vertex_ai.project_id_placeholder')
    const locationInput = screen.getByRole('combobox')

    expect(clientEmailInput.closest('.ant-input-status-error')).not.toBeNull()
    expect(privateKeyTextarea.closest('.ant-input-status-error')).not.toBeNull()
    expect(projectIdInput.closest('.ant-input-status-error')).not.toBeNull()
    expect(locationInput.closest('.ant-select-status-error')).not.toBeNull()
  })

  it('toggles JSON and private key visibility from the embedded input buttons', () => {
    const { container } = render(<VertexAISettings />)

    const jsonTextarea = screen.getByPlaceholderText(
      'settings.provider.vertex_ai.service_account.json_input_placeholder'
    )
    const privateKeyTextarea = screen.getByPlaceholderText(
      'settings.provider.vertex_ai.service_account.private_key_placeholder'
    )
    const [jsonToggle, privateKeyToggle] = screen.getAllByRole('button', {
      name: /settings\.provider\.vertex_ai\.service_account\.(json_input|private_key)/
    })

    expect(jsonTextarea.getAttribute('style')).toContain('-webkit-text-security: disc')
    expect(privateKeyTextarea.getAttribute('style')).toContain('-webkit-text-security: disc')

    fireEvent.click(jsonToggle)
    fireEvent.click(privateKeyToggle)

    expect(jsonTextarea.getAttribute('style')).toContain('-webkit-text-security: none')
    expect(privateKeyTextarea.getAttribute('style')).toContain('-webkit-text-security: none')

    expect(
      container.querySelectorAll('button[aria-label="settings.provider.vertex_ai.service_account.json_input"]')
    ).toHaveLength(1)
    expect(
      container.querySelectorAll('button[aria-label="settings.provider.vertex_ai.service_account.private_key"]')
    ).toHaveLength(1)
  })

  it('persists a custom Vertex location on blur', async () => {
    render(<VertexAISettings />)

    const locationInput = screen.getByRole('combobox')

    fireEvent.change(locationInput, {
      target: {
        value: 'europe-west8 '
      }
    })
    fireEvent.blur(locationInput)

    await waitFor(() => {
      expect(mockSetLocation).toHaveBeenCalledWith('europe-west8')
    })
  })
})
