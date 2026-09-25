import { createFileRoute } from '@tanstack/react-router'

import { SkillDetails } from '@renderer/pages/settings/SkillDetails/SkillDetails'

export const Route = createFileRoute('/settings/skills/$skillId')({
  component: SkillDetailsRoute
})

function SkillDetailsRoute() {
  const { skillId } = Route.useParams()
  return <SkillDetails skillId={skillId} />
}
