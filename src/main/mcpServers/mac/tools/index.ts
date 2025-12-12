import type { ToolResponse } from '../types'
import { calendarToolDefinition, handleCalendar } from './calendar'
import { handleMail, mailToolDefinition } from './mail'
import { handleNotes, notesToolDefinition } from './notes'
import { handleReminders, remindersToolDefinition } from './reminders'

export { calendarToolDefinition, handleCalendar } from './calendar'
export { handleMail, mailToolDefinition } from './mail'
export { handleNotes, notesToolDefinition } from './notes'
export { handleReminders, remindersToolDefinition } from './reminders'

export const toolDefinitions = [
  notesToolDefinition,
  mailToolDefinition,
  calendarToolDefinition,
  remindersToolDefinition
]

export const toolHandlers: Record<string, (args: unknown) => Promise<ToolResponse>> = {
  notes: handleNotes,
  mail: handleMail,
  calendar: handleCalendar,
  reminders: handleReminders
}
