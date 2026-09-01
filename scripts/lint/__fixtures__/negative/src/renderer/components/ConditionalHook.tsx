import { useState } from 'react'

// Calls a Hook inside a conditional branch — must trip `react/rules-of-hooks`.
export function ConditionalHook({ enabled }: { enabled: boolean }) {
  if (enabled) {
    const [count] = useState(0)
    return <span>{count}</span>
  }
  return null
}
