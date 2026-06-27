import type { SettingsPath } from '@shared/data/types/settingsPath'
import * as z from 'zod'

import { defineRoute } from '../define'

export const navigationRequestSchemas = {
  'navigation.open_settings': defineRoute({
    input: z.object({
      path: z.string()
    }),
    output: z.void()
  })
}

export type NavigationEventSchemas = {
  'navigation.open_settings': {
    path: SettingsPath
  }
}
