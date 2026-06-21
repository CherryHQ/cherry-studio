import type { Provider } from '@shared/data/types/provider'
import { render, screen } from '@testing-library/react'
import type { PropsWithChildren } from 'react'
import { createContext, use } from 'react'
import { describe, expect, it, vi } from 'vitest'

import GroqSettingsGroup from '../GroqSettingsGroup'

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
    verbosity: false
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
