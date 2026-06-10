import { ENDPOINT_TYPE, type Model, REASONING_EFFORT } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { fireEvent, render, screen } from '@testing-library/react'
import type { PropsWithChildren } from 'react'
import { createContext, use } from 'react'
import { describe, expect, it, vi } from 'vitest'

import OpenaiSettingsGroup from '..'

vi.mock('@renderer/pages/settings', () => ({
  SettingDivider: () => <hr />,
  SettingGroup: ({ children }: PropsWithChildren) => <section>{children}</section>,
  SettingRow: ({ children }: PropsWithChildren) => <div>{children}</div>,
  SettingTitle: ({ children }: PropsWithChildren) => <h2>{children}</h2>
}))

vi.mock('@renderer/components/chat/settings/settingsPanelPrimitives', () => ({
  SettingGroup: ({ children }: PropsWithChildren) => <div>{children}</div>,
  SettingRowTitleSmall: ({ children }: PropsWithChildren) => <span>{children}</span>
}))

const SelectContext = createContext<((value: string) => void) | undefined>(undefined)

vi.mock('@cherrystudio/ui', () => ({
  Select: ({
    children,
    disabled,
    onValueChange
  }: PropsWithChildren<{ disabled?: boolean; onValueChange?: (value: string) => void; value?: string }>) => (
    <SelectContext value={disabled ? undefined : onValueChange}>{children}</SelectContext>
  ),
  SelectContent: ({ children }: PropsWithChildren) => <div>{children}</div>,
  SelectItem: ({ children, value }: PropsWithChildren<{ className?: string; value: string }>) => {
    const onValueChange = use(SelectContext)
    return (
      <button type="button" onClick={() => onValueChange?.(value)}>
        {children}
      </button>
    )
  },
  SelectTrigger: ({
    children,
    disabled
  }: PropsWithChildren<{ className?: string; disabled?: boolean; size?: string }>) => (
    <button type="button" data-testid="select-trigger" disabled={disabled}>
      {children}
    </button>
  ),
  SelectValue: () => <span />
}))

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: vi.fn() },
  useTranslation: () => ({ t: (key: string) => key })
}))

const model = {
  id: 'openai::gpt-5.1',
  providerId: 'openai',
  name: 'gpt-5.1',
  capabilities: [],
  supportsStreaming: true,
  isEnabled: true,
  isHidden: false,
  endpointTypes: [ENDPOINT_TYPE.OPENAI_RESPONSES],
  reasoning: {
    type: 'openai',
    supportedEfforts: [REASONING_EFFORT.LOW, REASONING_EFFORT.MEDIUM, REASONING_EFFORT.HIGH]
  }
} satisfies Model

const provider = {
  id: 'openai',
  name: 'OpenAI',
  endpointConfigs: {
    [ENDPOINT_TYPE.OPENAI_RESPONSES]: {}
  },
  defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_RESPONSES,
  apiKeys: [],
  authType: 'api-key',
  apiFeatures: {
    arrayContent: true,
    streamOptions: true,
    developerRole: false,
    serviceTier: true,
    verbosity: true
  },
  settings: {
    serviceTier: 'auto',
    summaryText: 'auto',
    verbosity: 'low',
    streamOptions: {
      includeUsage: false
    }
  },
  isEnabled: true
} satisfies Provider

describe('OpenaiSettingsGroup', () => {
  it('writes advanced settings through provider settings patches', () => {
    const onProviderSettingsChange = vi.fn()

    render(
      <OpenaiSettingsGroup model={model} provider={provider} onProviderSettingsChange={onProviderSettingsChange} />
    )

    fireEvent.click(screen.getByText('settings.openai.summary_text_mode.detailed'))
    fireEvent.click(screen.getByText('settings.openai.verbosity.high'))
    fireEvent.click(screen.getByText('common.on'))

    expect(onProviderSettingsChange).toHaveBeenCalledWith({ summaryText: 'detailed' })
    expect(onProviderSettingsChange).toHaveBeenCalledWith({ verbosity: 'high' })
    expect(onProviderSettingsChange).toHaveBeenCalledWith({ streamOptions: { includeUsage: true } })
  })

  it('disables every setting select while provider settings are updating', () => {
    render(<OpenaiSettingsGroup model={model} provider={provider} disabled onProviderSettingsChange={vi.fn()} />)

    screen.getAllByTestId('select-trigger').forEach((trigger) => {
      expect(trigger).toBeDisabled()
    })
  })
})
