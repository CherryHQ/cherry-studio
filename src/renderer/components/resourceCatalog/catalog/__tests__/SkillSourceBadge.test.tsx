import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

import { SkillSourceBadge } from '../SkillSourceBadge'

describe('SkillSourceBadge', () => {
  it('derives the registry label from an exact marketplace Skill URL', () => {
    render(<SkillSourceBadge source="marketplace" sourceUrl="https://skills.sh/owner/repo/writer" />)

    expect(screen.getByText('settings.skills.source.marketplace · skills.sh')).toBeInTheDocument()
  })

  it('does not guess a registry from a repository-root legacy URL', () => {
    render(<SkillSourceBadge source="marketplace" sourceUrl="https://github.com/owner/repo" />)

    expect(screen.getByText('settings.skills.source.marketplace')).toBeInTheDocument()
  })
})
