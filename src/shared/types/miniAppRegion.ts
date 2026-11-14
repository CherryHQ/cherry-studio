export interface MiniAppRegionProfile {
  readonly labelKey: string
  readonly locale: string
  readonly languages: readonly string[]
  readonly timeZone: string
  readonly latitude: number
  readonly longitude: number
}

export const MINI_APP_REGIONS = {
  US: {
    labelKey: 'settings.developer.fake.countries.US',
    locale: 'en-US',
    languages: ['en-US', 'en'],
    timeZone: 'America/Los_Angeles',
    latitude: 34.0522,
    longitude: -118.2437
  },
  JP: {
    labelKey: 'settings.developer.fake.countries.JP',
    locale: 'ja-JP',
    languages: ['ja-JP', 'ja'],
    timeZone: 'Asia/Tokyo',
    latitude: 35.6762,
    longitude: 139.6503
  },
  SG: {
    labelKey: 'settings.developer.fake.countries.SG',
    locale: 'en-SG',
    languages: ['en-SG', 'en'],
    timeZone: 'Asia/Singapore',
    latitude: 1.3521,
    longitude: 103.8198
  },
  GB: {
    labelKey: 'settings.developer.fake.countries.GB',
    locale: 'en-GB',
    languages: ['en-GB', 'en'],
    timeZone: 'Europe/London',
    latitude: 51.5074,
    longitude: -0.1278
  },
  FR: {
    labelKey: 'settings.developer.fake.countries.FR',
    locale: 'fr-FR',
    languages: ['fr-FR', 'fr'],
    timeZone: 'Europe/Paris',
    latitude: 48.8566,
    longitude: 2.3522
  },
  DE: {
    labelKey: 'settings.developer.fake.countries.DE',
    locale: 'de-DE',
    languages: ['de-DE', 'de'],
    timeZone: 'Europe/Berlin',
    latitude: 52.52,
    longitude: 13.405
  }
} as const satisfies Record<string, MiniAppRegionProfile>

export type MiniAppCountry = keyof typeof MINI_APP_REGIONS

export type MiniAppRegionSelections = Record<string, MiniAppCountry | null>
