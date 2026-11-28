import { readAmpSubscriptionUsage } from './accountUsage'

export const ampSubscriptionUsage = { transport: 'terminal', read: readAmpSubscriptionUsage } as const
