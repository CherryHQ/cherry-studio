import type { Model } from '@renderer/types'
import { ENDPOINT_TYPE } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { fireEvent, render, screen } from '@testing-library/react'
import type { PropsWithChildren, ReactNode } from 'react'
import { createContext, use } from 'react'
import { describe, expect, it, vi } from 'vitest'

import OpenAISettingsGroup from '..'

vi.mock('@renderer/pages/settings', () => ({
  SettingDivider: () => <hr />,
  SettingRow: ({ children }: PropsWithChildren) => <div>{children}</div>
}))

vi.mock('@renderer/pages/settings/SettingGroup', () => ({
  CollapsibleSettingGroup: ({ title, children }: PropsWithChildren<{ title: ReactNode }>) => (
    <section>
      <h2>{title}</h2>
      {children}
    </section>
  )
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
  id: 'gpt-5.1',
  provider: 'openai',
  name: 'gpt-5.1',
  group: '',
  supported_endpoint_types: ['openai-response']
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
    verbosity: true,
    enableThinking: true
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

describe('OpenAISettingsGroup', () => {
  it('writes advanced settings through provider settings patches', () => {
    const onProviderSettingsChange = vi.fn()

    render(
      <OpenAISettingsGroup
        model={model}
        provider={provider}
        onProviderSettingsChange={onProviderSettingsChange}
        SettingGroup={({ children }) => <div>{children}</div>}
        SettingRowTitleSmall={({ children }) => <span>{children}</span>}
      />
    )

    fireEvent.click(screen.getByText('settings.openai.summary_text_mode.detailed'))
    fireEvent.click(screen.getByText('settings.openai.verbosity.high'))
    fireEvent.click(screen.getByText('common.on'))

    expect(onProviderSettingsChange).toHaveBeenCalledWith({ summaryText: 'detailed' })
    expect(onProviderSettingsChange).toHaveBeenCalledWith({ verbosity: 'high' })
    expect(onProviderSettingsChange).toHaveBeenCalledWith({ streamOptions: { includeUsage: true } })
  })

  it('disables every setting select while provider settings are updating', () => {
    render(
      <OpenAISettingsGroup
        model={model}
        provider={provider}
        disabled
        onProviderSettingsChange={vi.fn()}
        SettingGroup={({ children }) => <div>{children}</div>}
        SettingRowTitleSmall={({ children }) => <span>{children}</span>}
      />
    )

    screen.getAllByTestId('select-trigger').forEach((trigger) => {
      expect(trigger).toBeDisabled()
    })
  })
})
