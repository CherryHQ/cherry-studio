import { createHash } from 'node:crypto'

import { application } from '@application'

export function uarPrincipalForSession(sessionId: string): string {
  void sessionId
  return `boss.${createHash('sha256').update(application.getPath('app.userdata')).digest('hex')}`
}
