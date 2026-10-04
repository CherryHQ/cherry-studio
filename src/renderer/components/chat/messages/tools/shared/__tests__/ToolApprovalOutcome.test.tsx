import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { ToolApprovalOutcome } from '../ToolApprovalOutcome'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

describe('ToolApprovalOutcome', () => {
  it('displays the exact stored user reason, including surrounding spaces and newlines', () => {
    const reason = '  请先解释 "风险"\n再执行  '
    const { container } = render(<ToolApprovalOutcome approval={{ approved: false, reason }} />)

    expect(container.querySelector('.whitespace-pre-wrap')?.textContent).toBe(
      `agent.toolPermission.reasonLabel: ${reason}`
    )
  })

  it('does not display a reason when none was given', () => {
    const { container } = render(<ToolApprovalOutcome approval={{ approved: false }} />)

    expect(container.querySelector('.whitespace-pre-wrap')).toBeNull()
  })
})
