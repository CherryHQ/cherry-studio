import { Elysia } from 'elysia'

import { application } from '@application'

// Unauthenticated on purpose: the descriptor holds no secrets, and a Bearer token here would cross the LAN in plaintext.
export const remoteAgentRoutes = new Elysia().get(
  '/v1/remote-agent',
  ({ set }) => {
    set.headers['cache-control'] = 'no-store'
    const connection = application.get('RemoteAccessService').peekConnectionInfo()
    if (!connection) {
      set.status = 503
      return { error: 'Remote Agent access is unavailable' }
    }
    return connection
  },
  { detail: { hide: true } }
)
