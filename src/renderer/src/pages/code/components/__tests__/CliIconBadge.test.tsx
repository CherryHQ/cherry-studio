import { AddCategory } from '@cherrystudio/ui/icons'
import { codeCLI } from '@shared/config/constant'
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { CliIconBadge } from '../CliIconBadge'
import type { CodeToolMeta } from '../types'

describe('CliIconBadge', () => {
  it('renders icon components as inline svg instead of img tags', () => {
    const tool = {
      id: codeCLI.claudeCode,
      label: 'Claude Code',
      icon: AddCategory
    } satisfies CodeToolMeta

    const { container } = render(<CliIconBadge tool={tool} size={44} />)

    expect(container.querySelector('svg')).toBeTruthy()
    expect(container.querySelector('img')).toBeNull()
  })
})
