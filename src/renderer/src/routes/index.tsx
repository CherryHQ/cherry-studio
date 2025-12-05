import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/')({
  component: Index
})

function Index() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-8">
      <h3 className="font-semibold text-xl">Home</h3>
      <p className="text-muted-foreground text-sm">TODO: Migrate HomePage</p>
    </div>
  )
}
