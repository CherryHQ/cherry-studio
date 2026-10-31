type OutputPart = ({ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }) & {
  annotations?: { audience: ['assistant'] }
}

interface Observation {
  id: string
  text: string
  images: { data: string; mimeType: string }[]
  imagesOmitted: boolean
}

export class AutomationOutput {
  private readonly observations: Observation[] = []
  private sequence = 0
  private omitted = 0

  add(value: Record<string, unknown>, images: Observation['images'] = []): void {
    const sequence = ++this.sequence
    const id = String(value.id ?? sequence)
    const text = JSON.stringify({ ...value, sequence })
    this.observations.push({
      id,
      text:
        text.length <= 48_000
          ? text
          : 'Text OMITTED: exceeds 48,000 characters; no complete state was delivered. Request a narrower observation.',
      images,
      imagesOmitted: false
    })
    if (this.observations.length > 32) {
      this.observations.shift()
      this.omitted++
    }
    let count = 0
    let bytes = 0
    for (const observation of this.observations.toReversed()) {
      const size = observation.images.reduce((sum, image) => sum + image.data.length, 0)
      if (count + observation.images.length > 4 || bytes + size > 16_000_000) {
        observation.imagesOmitted = observation.images.length > 0 || observation.imagesOmitted
        observation.images = []
      } else {
        count += observation.images.length
        bytes += size
      }
    }
  }

  content(): OutputPart[] {
    let textChars = 0
    const groups: OutputPart[][] = []
    for (const observation of this.observations.toReversed()) {
      const parts: OutputPart[] = []
      if (textChars + observation.text.length <= 48_000) {
        parts.push({ type: 'text', text: `OBSERVATION ${observation.id}\n${observation.text}` })
        textChars += observation.text.length
        parts.push(...observation.images.map((image) => ({ type: 'image' as const, ...image })))
        if (observation.imagesOmitted)
          parts.push({
            type: 'text',
            text: `Images for observation ${observation.id} were OMITTED due to the output budget. They are not visible evidence.`
          })
      } else {
        parts.push({ type: 'text', text: `Observation ${observation.id} was OMITTED due to the output budget.` })
      }
      groups.push(
        observation.images.length > 0 || observation.imagesOmitted
          ? parts.map((part) => ({ ...part, annotations: { audience: ['assistant'] } }))
          : parts
      )
    }
    return [
      ...(this.omitted
        ? [
            {
              type: 'text' as const,
              text: `${this.omitted} earlier observations were OMITTED; only the latest 32 are retained.`
            }
          ]
        : []),
      ...groups.reverse().flat()
    ]
  }
}
