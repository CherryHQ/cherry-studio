import type { Provider } from '@shared/data/types/provider'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { ConfigList } from '../ConfigList'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('@cherrystudio/ui', () => ({
  EmptyState: ({ title }: { title: string }) => <div>{title}</div>,
  ReorderableList: (props: { gap: string }) => <div data-testid="code-config-reorderable-list" data-gap={props.gap} />
}))

const provider = {
  id: 'anthropic',
  name: 'Anthropic'
} as Provider

describe('ConfigList', () => {
  it('matches provider settings list spacing', () => {
    render(
      <ConfigList
        providers={[provider]}
        providerConfigs={{}}
        currentProviderId={null}
        resolveMeta={() => ({ providerName: 'Anthropic', modelName: 'claude-sonnet-4-5' })}
        onConfigure={vi.fn()}
        onToggleCurrent={vi.fn()}
        onReorder={vi.fn()}
      />
    )

    expect(screen.getByTestId('code-config-reorderable-list')).toHaveAttribute('data-gap', '0.5rem')
  })
})
