import type { ReactNode } from 'react'

import type { Assistant } from '@shared/types'

export function Example({ assistant, children }: { assistant: Assistant; children: ReactNode }) {
  return <section data-id={assistant.id}>{children}</section>
}
