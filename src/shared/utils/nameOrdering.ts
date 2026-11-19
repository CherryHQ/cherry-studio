import { defaultLanguage } from './languages'

export function createNameComparator(locale = defaultLanguage, direction: 'asc' | 'desc' = 'asc') {
  const collator = new Intl.Collator([locale, defaultLanguage], {
    usage: 'sort',
    numeric: true,
    sensitivity: 'accent',
    ignorePunctuation: false
  })
  return (a: { id: string; name?: string }, b: { id: string; name?: string }) =>
    (direction === 'asc' ? 1 : -1) * collator.compare(a.name ?? '', b.name ?? '') ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}
