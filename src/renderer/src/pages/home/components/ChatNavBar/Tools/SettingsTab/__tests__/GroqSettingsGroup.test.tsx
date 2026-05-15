import type { Provider } from '@shared/data/types/provider'
import { render, screen } from '@testing-library/react'
import type { PropsWithChildren, ReactNode } from 'react'
import { createContext, use } from 'react'
import { describe, expect, it, vi } from 'vitest'

import GroqSettingsGroup from '../GroqSettingsGroup'

vi.mock('@renderer/pages/settings', () => ({
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

vi.mock('@renderer/pages/chat-settings/settingsPanelPrimitives', () => ({
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

const provider = {
  id: 'groq',
  name: 'Groq',
  apiKeys: [],
  authType: 'api-key',
  apiFeatures: {
    arrayContent: true,
    streamOptions: true,
    developerRole: false,
    serviceTier: true,
    verbosity: false,
    enableThinking: true
  },
  settings: {
    serviceTier: 'auto'
  },
  isEnabled: true
} satisfies Provider

describe('GroqSettingsGroup', () => {
  it('disables the service-tier select while provider settings are updating', () => {
    render(<GroqSettingsGroup provider={provider} disabled onProviderSettingsChange={vi.fn()} />)

    expect(screen.getByTestId('select-trigger')).toBeDisabled()
  })
})
