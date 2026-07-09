import type * as CherryStudioUi from '@cherrystudio/ui'
import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockNormalTooltipProps, mockLoggerWarn } = vi.hoisted(() => ({
  mockNormalTooltipProps: [] as Array<{ sideOffset?: number }>,
  mockLoggerWarn: vi.fn()
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      warn: mockLoggerWarn
    })
  }
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, string>) => {
      const labels: Record<string, string> = {
        'library.config.prompt.copy_variable': `Copy ${options?.variable}`,
        'library.config.prompt.variables_description': 'Variables can be used in prompts.',
        'library.config.prompt.variables_example': `Example ${options?.variable}`,
        'library.config.prompt.variables_title': 'System variables',
        'library.config.prompt.vars.arch': 'Architecture',
        'library.config.prompt.vars.date': 'Date',
        'library.config.prompt.vars.datetime': 'Datetime',
        'library.config.prompt.vars.language': 'Language',
        'library.config.prompt.vars.model_name': 'Model name',
        'library.config.prompt.vars.os': 'OS',
        'library.config.prompt.vars.time': 'Time',
        'library.config.prompt.vars.username': 'Username'
      }
      return labels[key] ?? key
    }
  })
}))

vi.mock('@cherrystudio/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof CherryStudioUi>()
  return {
    ...actual,
    NormalTooltip: ({
      children,
      content,
      sideOffset
    }: {
      children: ReactNode
      content: ReactNode
      sideOffset?: number
    }) => {
      mockNormalTooltipProps.push({ sideOffset })
      return (
        <div>
          {children}
          <div data-testid="tooltip-content">{content}</div>
        </div>
      )
    }
  }
})

import { PromptVariablesPopover } from '../EditDialogShared'

describe('PromptVariablesPopover', () => {
  const writeText = vi.fn()

  beforeEach(() => {
    writeText.mockResolvedValue(undefined)
    mockLoggerWarn.mockReset()
    mockNormalTooltipProps.length = 0
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText }
    })
  })

  it('copies a prompt variable from the tooltip content', async () => {
    render(<PromptVariablesPopover portalContainer={null} />)

    fireEvent.click(screen.getByRole('button', { name: 'Copy {{date}}' }))

    expect(writeText).toHaveBeenCalledWith('{{date}}')
    expect(mockLoggerWarn).not.toHaveBeenCalled()
    expect(mockNormalTooltipProps.at(-1)).toMatchObject({ sideOffset: 0 })
  })
})
