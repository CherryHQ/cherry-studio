import { isRedirect } from '@tanstack/react-router'
import { expect, it } from 'vitest'

import { CodeCli } from '@shared/types/codeCli'

import { Route } from '../app/code'

const beforeLoad = Route.options.beforeLoad as (context: { search: { id?: string; tool?: CodeCli } }) => void

it.each([{ id: 'cursor' }, { tool: CodeCli.OPENAI_CODEX }])(
  'redirects old CodeMate links preserving selection: %j',
  (search) => {
    let result: unknown
    try {
      beforeLoad({ search })
    } catch (error) {
      result = error
    }
    expect(isRedirect(result)).toBe(true)
    expect(result).toMatchObject({ options: { to: '/settings/local-agents', search, replace: true } })
  }
)
