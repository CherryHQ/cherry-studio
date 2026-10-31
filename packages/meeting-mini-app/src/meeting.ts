import * as z from 'zod'

export const MAX_TEXT_BYTES = 500_000
export const mindMapSchema = z.array(z.object({ Title: z.string(), Topic: z.array(z.unknown()) }))
export interface MindNode {
  Title: string
  Topic: MindNode[]
}

export function parseMindMap(value: unknown, depth = 0): MindNode[] {
  if (depth > 12) throw new Error('invalidResponse')
  return mindMapSchema.parse(value).map((node) => ({ Title: node.Title, Topic: parseMindMap(node.Topic, depth + 1) }))
}

export const meetingSchema = z.strictObject({
  version: z.literal(1),
  id: z.uuid(),
  title: z.string().min(1).max(200),
  text: z
    .string()
    .min(1)
    .refine((text) => new TextEncoder().encode(text).length <= MAX_TEXT_BYTES),
  createdAt: z.number().int().positive(),
  taskId: z.string().max(128).optional(),
  summary: z.string().default(''),
  summaryHtml: z.string().max(1_000_000).optional(),
  mindMap: z.array(z.unknown()).default([])
})
export type Meeting = z.infer<typeof meetingSchema>

export function importMeeting(name: string, input: string): Meeting {
  if (new TextEncoder().encode(input).length > 5_000_000) throw new Error('fileTooLarge')
  const data = name.toLowerCase().endsWith('.json')
    ? meetingSchema.parse(JSON.parse(input))
    : {
        version: 1,
        id: crypto.randomUUID(),
        title: name.replace(/\.[^.]+$/, '').slice(0, 200) || 'Meeting',
        text: input.replace(/^\uFEFF/, '').trim(),
        createdAt: Date.now(),
        summary: '',
        mindMap: []
      }
  const meeting = meetingSchema.parse(data)
  parseMindMap(meeting.mindMap)
  // Imports are independent local records; a server task belongs to the original upload.
  return { ...meeting, id: crypto.randomUUID(), taskId: undefined, createdAt: Date.now() }
}

export function meetingMarkdown(meeting: Meeting): string {
  const lines = [`# ${meeting.title}`, '', meeting.summary, '', '---', '', meeting.text]
  const append = (nodes: MindNode[], depth: number) => {
    for (const node of nodes) {
      lines.push(`${'  '.repeat(depth)}- ${node.Title}`)
      append(node.Topic, depth + 1)
    }
  }
  if (meeting.mindMap.length) {
    lines.push('', '---', '')
    append(parseMindMap(meeting.mindMap), 0)
  }
  return lines.join('\n')
}

export function encodeText(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

export function decodeText(text: string): string {
  return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(atob(text), (char) => char.charCodeAt(0)))
}

export async function loadMeetings(): Promise<Meeting[]> {
  const { names } = await window.cherry.file.list()
  const meetings: Meeting[] = []
  for (const name of names.filter((name) => name.startsWith('meeting-') && name.endsWith('.json'))) {
    const { data } = await window.cherry.file.load(name)
    if (!data) continue
    const meeting = meetingSchema.parse(JSON.parse(decodeText(data)))
    parseMindMap(meeting.mindMap)
    meetings.push(meeting)
  }
  return meetings.sort((a, b) => b.createdAt - a.createdAt)
}

export async function saveMeeting(meeting: Meeting): Promise<void> {
  meetingSchema.parse(meeting)
  await window.cherry.file.save(`meeting-${meeting.id}.json`, encodeText(JSON.stringify(meeting)))
}
