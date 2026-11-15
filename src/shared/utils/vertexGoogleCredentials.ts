/** `credentials.type` of a Vertex AI "Sign in with Google" `iam-gcp` authConfig. */
export const VERTEX_AUTHORIZED_USER_TYPE = 'authorized_user' as const

/** What the renderer receives for Google sign-in credentials: the client and a signed-in flag, never a token. */
export type VertexAuthorizedUserView = {
  type: typeof VERTEX_AUTHORIZED_USER_TYPE
  clientId?: string
  clientSecret?: string
  account?: string
  signedIn: boolean
}

/** True when the stored credentials are a Google user sign-in, signed in or not. */
export function isVertexAuthorizedUserCredentials(credentials: Record<string, unknown> | undefined): boolean {
  return credentials?.type === VERTEX_AUTHORIZED_USER_TYPE
}
