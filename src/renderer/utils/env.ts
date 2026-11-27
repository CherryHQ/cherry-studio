import { parse } from 'dotenv'

export const parseKeyValueString = (str: string): Record<string, string> => {
  // Protect literal '#' from dotenv's inline-comment rule; escaping '%' keeps the mapping reversible.
  const protectedInput = str.replace(/[%#]/g, (char) => (char === '%' ? '%25' : '%23'))
  const values = parse(protectedInput)
  for (const key of Object.keys(values)) {
    values[key] = values[key].replace(/%25|%23/g, (token) => (token === '%25' ? '%' : '#'))
  }
  return values
}
