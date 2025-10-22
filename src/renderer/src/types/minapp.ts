import { CSSProperties } from 'react'

export type MinAppType = {
  id: string
  name: string
  logo?: string
  url: string
  bodered?: boolean
  background?: string
  style?: CSSProperties
  addTime?: string
  type?: 'Custom' | 'Default' // Added the 'type' property
}
