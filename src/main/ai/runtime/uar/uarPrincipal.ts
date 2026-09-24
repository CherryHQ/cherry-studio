import { createHash } from 'node:crypto'

import { application } from '@application'

export function uarPrincipalForSession(sessionId: string): string {
  return `boss.${createHash('sha256')
    .update(`${application.getPath('app.userdata')}\0${sessionId}`)
    .digest('hex')}`
}
