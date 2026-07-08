import CodeCliPage from '@renderer/pages/code/CodeCliPage'
import { CodeCli } from '@shared/types/codeCli'
import { createFileRoute } from '@tanstack/react-router'

// `launch` lets another page (e.g. Settings > Dependencies) deep-link straight to
// a tool's launch dialog. Untrusted, so validate against the CodeCli enum.
export interface CodeSearch {
  launch?: CodeCli
}

export const Route = createFileRoute('/app/code')({
  component: CodeCliPage,
  validateSearch: (search: Record<string, unknown>): CodeSearch => {
    const { launch } = search
    return typeof launch === 'string' && (Object.values(CodeCli) as string[]).includes(launch)
      ? { launch: launch as CodeCli }
      : {}
  }
})
