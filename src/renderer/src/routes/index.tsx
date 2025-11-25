import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/')({
  component: Index
})

function Index() {
  return (
    <div style={{ padding: 20 }}>
      <h3>Welcome to Cherry Studio!</h3>
      <p>Select a tab to start.</p>
    </div>
  )
}
