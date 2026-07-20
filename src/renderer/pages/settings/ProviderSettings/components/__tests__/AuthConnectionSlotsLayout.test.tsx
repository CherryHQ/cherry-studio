import AuthConnectionSlotsLayout from '@renderer/pages/settings/ProviderSettings/ConnectionSettings/AuthConnectionSlotsLayout'
import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

type TestProvider = { id: string; presetProviderId?: string }

const { providersById } = vi.hoisted(() => ({
  providersById: new Map<string, TestProvider>()
}))

vi.mock('@renderer/hooks/useProvider', () => ({
  useProvider: (providerId: string) => ({ provider: providersById.get(providerId) })
}))

vi.mock('@shared/utils/provider', () => ({
  matchesPreset: (provider: TestProvider, presetId: string) =>
    provider?.id === presetId || provider?.presetProviderId === presetId
}))

vi.mock('../../ProviderSpecific/ProviderSpecificSettings', () => ({
  default: ({ placement }: any) => <div>{placement}</div>
}))

describe('AuthConnectionSlotsLayout', () => {
  beforeEach(() => {
    providersById.clear()
  })

  it('renders provider-specific slots and core content in order', () => {
    const { container } = render(
      <AuthConnectionSlotsLayout providerId="openai">
        <div>core</div>
      </AuthConnectionSlotsLayout>
    )
    const text = container.textContent ?? ''

    expect(text).toContain('beforeAuth')
    expect(text).toContain('core')
    expect(text).toContain('afterAuth')
    expect(text.indexOf('beforeAuth')).toBeLessThan(text.indexOf('core'))
    expect(text.indexOf('core')).toBeLessThan(text.indexOf('afterAuth'))
  })

  it('renders core content inside the shell card', () => {
    const { container } = render(
      <AuthConnectionSlotsLayout providerId="openai">
        <div>core-only</div>
      </AuthConnectionSlotsLayout>
    )

    expect(container.textContent).toContain('core-only')
    expect(container.querySelector('section')).not.toBeNull()
  })

  it('does not render an extra configuration heading', () => {
    const { container } = render(
      <AuthConnectionSlotsLayout providerId="openai">
        <div>core</div>
      </AuthConnectionSlotsLayout>
    )

    expect(container.querySelector('h3')).toBeNull()
  })

  it('uses compact spacing only for AWS Bedrock', () => {
    const { container, rerender } = render(
      <AuthConnectionSlotsLayout providerId="aws-bedrock">
        <div>core</div>
      </AuthConnectionSlotsLayout>
    )

    expect(container.querySelector('.gap-1')).not.toBeNull()
    expect(container.querySelector('.gap-5')).toBeNull()

    rerender(
      <AuthConnectionSlotsLayout providerId="openai">
        <div>core</div>
      </AuthConnectionSlotsLayout>
    )

    expect(container.querySelector('.gap-5')).not.toBeNull()
    expect(container.querySelector('.gap-1')).toBeNull()
  })

  it('uses compact spacing for providers derived from the AWS Bedrock preset', () => {
    providersById.set('custom-bedrock', { id: 'custom-bedrock', presetProviderId: 'aws-bedrock' })

    const { container } = render(
      <AuthConnectionSlotsLayout providerId="custom-bedrock">
        <div>core</div>
      </AuthConnectionSlotsLayout>
    )

    expect(container.querySelector('.gap-1')).not.toBeNull()
    expect(container.querySelector('.gap-5')).toBeNull()
  })
})
