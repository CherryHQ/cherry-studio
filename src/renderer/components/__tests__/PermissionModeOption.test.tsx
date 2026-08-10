import { render, screen } from '@testing-library/react'
import type { TFunction } from 'i18next'
import { describe, expect, it } from 'vitest'

import { PermissionModeOptionLabel } from '../PermissionModeOption'

// The component only ever calls t(key, fallback); rendering the fallback keeps these
// assertions about layout rather than about the locale files.
const t = ((_key: string, fallback?: string) => fallback ?? '') as unknown as TFunction

const withWarning = {
  mode: 'auto' as const,
  titleKey: 'title.key',
  titleFallback: 'Approve for Me',
  descriptionKey: 'description.key',
  descriptionFallback: 'Runs without routine prompts.',
  warningKey: 'warning.key',
  warningFallback: 'Needs a model that supports it.'
}

const withoutWarning = {
  mode: 'default' as const,
  titleKey: 'title.key',
  titleFallback: 'Ask Before Acting',
  descriptionKey: 'description.key',
  descriptionFallback: 'Asks before editing files.'
}

describe('PermissionModeOptionLabel', () => {
  it('renders the warning alongside the description', () => {
    render(<PermissionModeOptionLabel card={withWarning} t={t} />)

    expect(screen.getByText('Runs without routine prompts.')).toBeInTheDocument()
    expect(screen.getByText('Needs a model that supports it.')).toBeInTheDocument()
  })

  // The compact surfaces (composer switcher, channel override) pass withDescription={false}.
  // A caveat the user needs before picking the mode must survive that, or those two
  // surfaces would offer the mode with no warning at all.
  it('keeps the warning when the description is suppressed', () => {
    render(<PermissionModeOptionLabel card={withWarning} t={t} withDescription={false} />)

    expect(screen.queryByText('Runs without routine prompts.')).not.toBeInTheDocument()
    expect(screen.getByText('Needs a model that supports it.')).toBeInTheDocument()
  })

  // Single-line containers (the composer quick panel row is a fixed 30px) opt out and
  // render the caveat themselves; a stacked warning would overflow the row.
  it('drops the warning line when the container cannot take a second line', () => {
    render(<PermissionModeOptionLabel card={withWarning} t={t} withDescription={false} withWarning={false} />)

    expect(screen.getByText('Approve for Me')).toBeInTheDocument()
    expect(screen.queryByText('Needs a model that supports it.')).not.toBeInTheDocument()
  })

  it('renders no warning line for a mode without one', () => {
    render(<PermissionModeOptionLabel card={withoutWarning} t={t} />)

    expect(screen.getByText('Ask Before Acting')).toBeInTheDocument()
    expect(screen.queryByText(/Needs a model/)).not.toBeInTheDocument()
  })
})
