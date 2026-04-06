import { parse } from 'dotenv'

export const parseKeyValueString = (str: string): Record<string, string> => {
  return parse(str)
}

export const serializeKeyValueString = (values: Record<string, string>): string => {
  return Object.entries(values)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')
}
