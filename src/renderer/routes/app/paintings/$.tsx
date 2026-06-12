import PaintingPage from '@renderer/pages/paintings'
import { createFileRoute } from '@tanstack/react-router'

// Catch-all splat route: any path under /app/paintings/* renders the same
// PaintingPage as the index route. The `$` segment is intentionally NOT read —
// the painting page resolves its initial provider from user preference, not
// from the URL, so this is not a provider deep-link (e.g. /app/paintings/zhipu
// does NOT open the zhipu provider). Do not assume deep-linking works here.
export const Route = createFileRoute('/app/paintings/$')({
  component: PaintingPage
})
