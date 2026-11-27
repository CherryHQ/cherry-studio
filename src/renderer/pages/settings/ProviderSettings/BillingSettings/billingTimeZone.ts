export function billingUtcOffset(timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone): string {
  const offset = new Intl.DateTimeFormat('en', { timeZone, timeZoneName: 'longOffset' })
    .formatToParts(new Date())
    .find((part) => part.type === 'timeZoneName')!.value
  return offset.replace('GMT', '') || '+00:00'
}

export const billingUtcOffsets = [
  ...Array.from({ length: 27 }, (_, index) => (index - 12) * 60),
  -570,
  -210,
  210,
  270,
  330,
  345,
  390,
  525,
  570,
  630,
  765,
  825
]
  .sort((a, b) => a - b)
  .map((minutes) => {
    const hours = String(Math.floor(Math.abs(minutes) / 60)).padStart(2, '0')
    return `${minutes < 0 ? '-' : '+'}${hours}:${String(Math.abs(minutes) % 60).padStart(2, '0')}`
  })
