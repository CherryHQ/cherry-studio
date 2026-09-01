export const APP_EDITIONS = ['global', 'cn'] as const

export type AppEdition = (typeof APP_EDITIONS)[number]
