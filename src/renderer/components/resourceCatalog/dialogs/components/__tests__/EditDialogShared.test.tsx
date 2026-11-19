import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as CherryStudioUi from '@cherrystudio/ui'

const { mockLoggerWarn, mockToastSuccess } = vi.hoisted(() => ({
  mockLoggerWarn: vi.fn(),
  mockToastSuccess: vi.fn()
}))

vi.mock('@cherrystudio/ui', async (importOriginal) => await importOriginal<typeof CherryStudioUi>())

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
        'library.config.prompt.vars.username': 'Username',
        'message.copy.success': 'Copied'
      }
      return labels[key] ?? key
    }
  })
}))

vi.mock('@renderer/services/toast', () => ({
  toast: {
    success: mockToastSuccess
  }
}))

import { PromptVariablesPopover } from '../EditDialogShared'

beforeAll(() => {
  HTMLElement.prototype.scrollIntoView = () => {}
})

describe('EditDialogShared', () => {
  const writeText = vi.fn()

  beforeEach(() => {
    mockToastSuccess.mockReset()
    writeText.mockResolvedValue(undefined)
    mockLoggerWarn.mockReset()
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText }
    })
  })

  it('opens the prompt variables popover from the keyboard and copies a variable', async () => {
    const portalContainer = document.createElement('div')
    document.body.append(portalContainer)

    try {
      render(<PromptVariablesPopover portalContainer={portalContainer} />)

      expect(screen.queryByRole('button', { name: 'Copy {{date}}' })).not.toBeInTheDocument()

      screen.getByRole('button', { name: 'System variables' }).focus()
      await userEvent.keyboard('{Enter}')

      const copyButton = await screen.findByRole('button', { name: 'Copy {{date}}' })
      expect(portalContainer.querySelector('[data-slot="popover-content"]')).toContainElement(copyButton)
      expect(copyButton).toHaveFocus()

      await userEvent.click(copyButton)

      expect(writeText).toHaveBeenCalledWith('{{date}}')
      await vi.waitFor(() => expect(mockToastSuccess).toHaveBeenCalledWith('Copied'))
      expect(mockLoggerWarn).not.toHaveBeenCalled()
    } finally {
      portalContainer.remove()
    }
  })
})
