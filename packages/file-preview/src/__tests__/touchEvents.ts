/** Dispatches a touch event carrying finger positions; jsdom has no Touch constructor to build real ones. */
export function dispatchTouch(target: EventTarget, type: string, points: Array<[number, number]>): Event {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'touches', { value: points.map(([clientX, clientY]) => ({ clientX, clientY })) })
  target.dispatchEvent(event)
  return event
}
