import { SkillDetails } from '@renderer/pages/settings/SkillDetails/SkillDetails'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/settings/skills/$skillId')({
  component: SkillDetailsRoute
})

function SkillDetailsRoute() {
  const { skillId } = Route.useParams()
  return <SkillDetails skillId={skillId} />
}
