import { type IconMeta } from '../../types'
import darkWebp from './dark.webp'
import lightWebp from './light.webp'

export const meta: IconMeta = {
  id: 'mcp',
  colorPrimary: '#020202',
  colorScheme: 'color',
  webp: {
    light: lightWebp,
    dark: darkWebp,
    size: 64
  }
}
