import { createContext } from 'react'

export const CaptureProviderNamesContext = createContext<ReadonlyMap<string, string> | null>(null)
