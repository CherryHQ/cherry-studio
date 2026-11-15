import type { AuthConfig } from '@shared/data/types/provider'
import {
  isVertexAuthorizedUserCredentials,
  VERTEX_AUTHORIZED_USER_TYPE,
  type VertexAuthorizedUserView
} from '@shared/utils/vertexGoogleCredentials'

// Together these keep one invariant for a Vertex Google sign-in: the renderer
// never sees a token, and a settings save that sends the view back never signs out.

const TOKEN_KEYS = ['refreshToken', 'accessToken', 'expiresAt'] as const
const SESSION_KEYS = [...TOKEN_KEYS, 'account'] as const

function readString(credentials: Record<string, unknown>, key: string): string | undefined {
  const value = credentials[key]
  return typeof value === 'string' ? value : undefined
}

/** Allowlisted renderer view of Google sign-in credentials. */
export function toVertexAuthorizedUserView(credentials: Record<string, unknown>): VertexAuthorizedUserView {
  const clientId = readString(credentials, 'clientId')
  const clientSecret = readString(credentials, 'clientSecret')
  const account = readString(credentials, 'account')
  return {
    type: VERTEX_AUTHORIZED_USER_TYPE,
    ...(clientId !== undefined && { clientId }),
    ...(clientSecret !== undefined && { clientSecret }),
    ...(account !== undefined && { account }),
    signedIn: Boolean(readString(credentials, 'refreshToken'))
  }
}

/**
 * Keep the stored Google session when a settings save sends the renderer view
 * back (no tokens) for the same OAuth client, and drop its `signedIn` flag.
 * The incoming `account` is only an echo of that view, so it is dropped too and
 * comes back only with a kept session; a changed client never keeps a stale email.
 */
export function preserveVertexGoogleSession(stored: AuthConfig | null | undefined, incoming: AuthConfig): AuthConfig {
  if (incoming.type !== 'iam-gcp' || !isVertexAuthorizedUserCredentials(incoming.credentials)) return incoming
  const credentials: Record<string, unknown> = { ...incoming.credentials }
  delete credentials.signedIn
  delete credentials.account

  const storedCredentials = stored?.type === 'iam-gcp' ? stored.credentials : undefined
  const keepsStoredSession =
    storedCredentials !== undefined &&
    isVertexAuthorizedUserCredentials(storedCredentials) &&
    storedCredentials.clientId === credentials.clientId &&
    TOKEN_KEYS.every((key) => credentials[key] === undefined)
  if (!keepsStoredSession) return { ...incoming, credentials }

  const session = Object.fromEntries(
    SESSION_KEYS.filter((key) => storedCredentials[key] !== undefined).map((key) => [key, storedCredentials[key]])
  )
  return { ...incoming, credentials: { ...credentials, ...session } }
}
