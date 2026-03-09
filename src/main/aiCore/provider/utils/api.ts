import { reduxService } from '@main/services/ReduxService'
import { formatApiHost, withoutTrailingSlash } from '@shared/utils'
import { trim } from 'lodash'

// NOTE: Since #13194, it's re-written with reduxService
// See: renderer/src/utils/api.ts: formatVertexApiHost
export async function formatVertexApiHost(host: string): Promise<string> {
  const { projectId: project, location } = (await reduxService.select('llm.settings.vertexai')) as {
    projectId: string
    location: string
  }
  const trimmedHost = withoutTrailingSlash(trim(host))
  if (!trimmedHost || trimmedHost.endsWith('aiplatform.googleapis.com')) {
    const fallbackHost =
      location == 'global' ? 'https://aiplatform.googleapis.com' : `https://${location}-aiplatform.googleapis.com`
    return `${formatApiHost(fallbackHost)}/projects/${project}/locations/${location}`
  }
  return formatApiHost(trimmedHost)
}
