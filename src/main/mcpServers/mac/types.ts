import * as z from 'zod'

// Tool response type (from MCP SDK pattern)
export type ToolResponse = {
  content: { type: string; text: string }[]
  isError: boolean
}

// Notes Types
export interface Note {
  name: string
  content: string
  folder?: string
  creationDate?: string
  modificationDate?: string
}

export interface CreateNoteResult {
  success: boolean
  note?: { name: string; folder: string }
  message?: string
}

// Notes Zod Schema
export const NotesArgsSchema = z.object({
  operation: z.enum(['search', 'list', 'create']),
  query: z.string().optional().describe('Search query for search operation'),
  limit: z.number().optional().describe('Maximum results to return'),
  title: z.string().optional().describe('Note title for create operation'),
  body: z.string().optional().describe('Note body for create operation'),
  folder: z.string().optional().describe('Folder name for create operation')
})

export type NotesArgs = z.infer<typeof NotesArgsSchema>

// Mail Types
export interface EmailMessage {
  id: string
  subject: string
  sender: string
  dateSent: string
  content: string
  isRead: boolean
  mailbox: string
}

export interface MailAccount {
  name: string
  id: string
}

export interface Mailbox {
  name: string
  account: string
  unreadCount: number
}

// Mail Zod Schema
export const MailArgsSchema = z.object({
  operation: z.enum(['unread', 'search', 'send', 'mailboxes', 'accounts', 'latest']),
  query: z.string().optional().describe('Search query'),
  limit: z.number().optional().describe('Maximum results'),
  to: z.string().optional().describe('Recipient email for send'),
  subject: z.string().optional().describe('Email subject for send'),
  body: z.string().optional().describe('Email body for send'),
  account: z.string().optional().describe('Account name filter'),
  mailbox: z.string().optional().describe('Mailbox name filter')
})

export type MailArgs = z.infer<typeof MailArgsSchema>

// Calendar Types
export interface CalendarEvent {
  id: string
  title: string
  location: string | null
  notes: string | null
  startDate: string | null
  endDate: string | null
  calendarName: string
  isAllDay: boolean
  url: string | null
}

export interface Calendar {
  name: string
  id: string
}

// Calendar Zod Schema
export const CalendarArgsSchema = z.object({
  operation: z.enum(['search', 'list', 'open', 'create']),
  query: z.string().optional().describe('Search query'),
  limit: z.number().optional().describe('Maximum results'),
  startDate: z.string().optional().describe('Start date ISO string'),
  endDate: z.string().optional().describe('End date ISO string'),
  title: z.string().optional().describe('Event title for create'),
  location: z.string().optional().describe('Event location'),
  notes: z.string().optional().describe('Event notes'),
  calendar: z.string().optional().describe('Calendar name'),
  isAllDay: z.boolean().optional().describe('All day event flag')
})

export type CalendarArgs = z.infer<typeof CalendarArgsSchema>

// Reminders Types
export interface ReminderList {
  name: string
  id: string
}

export interface Reminder {
  name: string
  id: string
  body: string
  completed: boolean
  dueDate: string | null
  listName: string
}

// Reminders Zod Schema
export const RemindersArgsSchema = z.object({
  operation: z.enum(['list', 'search', 'open', 'create', 'listById']),
  query: z.string().optional().describe('Search query'),
  limit: z.number().optional().describe('Maximum results'),
  listId: z.string().optional().describe('List ID for listById'),
  listName: z.string().optional().describe('List name for create'),
  name: z.string().optional().describe('Reminder name for create'),
  body: z.string().optional().describe('Reminder body'),
  dueDate: z.string().optional().describe('Due date ISO string')
})

export type RemindersArgs = z.infer<typeof RemindersArgsSchema>
