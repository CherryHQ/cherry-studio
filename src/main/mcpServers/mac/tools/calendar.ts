import { loggerService } from '@logger'

import {
  MAX_INPUT_LENGTHS,
  MAX_RESULTS,
  runAppleScript,
  sanitizeAppleScriptString,
  TIMEOUT_MS,
  validateInput
} from '../applescript'
import type { CalendarEvent, ToolResponse } from '../types'
import { CalendarArgsSchema } from '../types'
import { errorResponse, handleAppleScriptError, successResponse, truncateContent } from './utils'

const logger = loggerService.withContext('MacMCP')

// Tool definition for MCP
export const calendarToolDefinition = {
  name: 'calendar',
  description:
    'Interact with Apple Calendar app. Operations: search (find events), list (upcoming events or calendars), open (open app), create (new event). Requires macOS Automation permission.',
  inputSchema: {
    type: 'object',
    properties: {
      operation: {
        type: 'string',
        enum: ['search', 'list', 'open', 'create'],
        description: 'Operation to perform'
      },
      query: {
        type: 'string',
        description: 'Search query (for search operation)'
      },
      limit: {
        type: 'number',
        description: 'Maximum number of results to return'
      },
      startDate: {
        type: 'string',
        description: 'Start date ISO string (for search/create operations)'
      },
      endDate: {
        type: 'string',
        description: 'End date ISO string (for search/create operations)'
      },
      title: {
        type: 'string',
        description: 'Event title (for create operation)'
      },
      location: {
        type: 'string',
        description: 'Event location (for create operation)'
      },
      notes: {
        type: 'string',
        description: 'Event notes (for create operation)'
      },
      calendar: {
        type: 'string',
        description: 'Calendar name (for create operation)'
      },
      isAllDay: {
        type: 'boolean',
        description: 'All day event flag (for create operation)'
      }
    },
    required: ['operation']
  }
}

// Handler function
export async function handleCalendar(args: unknown): Promise<ToolResponse> {
  const parsed = CalendarArgsSchema.safeParse(args)
  if (!parsed.success) {
    return errorResponse(`Invalid arguments: ${parsed.error.message}`)
  }

  const { operation, ...rest } = parsed.data
  logger.info('Calendar tool called', { operation })

  try {
    switch (operation) {
      case 'search':
        return await searchEvents(rest.query, rest.startDate, rest.endDate, rest.limit)
      case 'list':
        return await listEvents(rest.startDate, rest.endDate, rest.limit)
      case 'open':
        return await openCalendar(rest.startDate)
      case 'create':
        return await createEvent(
          rest.title,
          rest.startDate,
          rest.endDate,
          rest.location,
          rest.notes,
          rest.calendar,
          rest.isAllDay
        )
      default:
        return errorResponse(`Unknown operation: ${operation}`)
    }
  } catch (error) {
    return handleAppleScriptError(error, 'Calendar', operation)
  }
}

// Helper: Convert ISO date string to AppleScript date format
function formatDateForAppleScript(isoDate: string): string {
  const date = new Date(isoDate)
  // AppleScript date format: "Monday, January 1, 2024 at 12:00:00 PM"
  const options: Intl.DateTimeFormatOptions = {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: true
  }
  return date.toLocaleString('en-US', options)
}

// Helper: Validate date is reasonable (not more than 10 years in past/future)
function validateDateRange(date: Date): void {
  const now = new Date()
  const tenYearsAgo = new Date(now.getFullYear() - 10, now.getMonth(), now.getDate())
  const tenYearsAhead = new Date(now.getFullYear() + 10, now.getMonth(), now.getDate())

  if (date < tenYearsAgo || date > tenYearsAhead) {
    throw new Error('Date must be within 10 years of current date')
  }
}

// Search events by query within date range
// NOTE: We avoid "whose" clause and use manual filtering for performance.
async function searchEvents(
  query?: string,
  startDate?: string,
  endDate?: string,
  limit?: number
): Promise<ToolResponse> {
  if (!query || query.trim() === '') {
    return errorResponse('Search query is required')
  }

  validateInput(query, MAX_INPUT_LENGTHS.searchQuery, 'Search query')
  const sanitizedQuery = sanitizeAppleScriptString(query.toLowerCase())
  const maxEvents = limit || MAX_RESULTS.events

  // Calculate days offset for AppleScript
  let daysBack = 0
  let daysForward = 30

  if (startDate) {
    const start = new Date(startDate)
    if (isNaN(start.getTime())) {
      return errorResponse('Invalid start date format')
    }
    validateDateRange(start)
    const now = new Date()
    // Clamp to non-negative to avoid AppleScript arithmetic issues
    daysBack = Math.max(0, Math.floor((now.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)))
  }

  if (endDate) {
    const end = new Date(endDate)
    if (isNaN(end.getTime())) {
      return errorResponse('Invalid end date format')
    }
    validateDateRange(end)
    const now = new Date()
    // Clamp to non-negative to avoid AppleScript arithmetic issues
    daysForward = Math.max(0, Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)))
  }

  const script = `
tell application "Calendar"
  set eventList to {}
  set eventCount to 0
  set nowDate to current date
  set startD to nowDate - (${daysBack} * days)
  set endD to nowDate + (${daysForward} * days)
  set searchQuery to "${sanitizedQuery}"

  repeat with cal in calendars
    if eventCount >= ${maxEvents} then exit repeat
    set calName to name of cal

    try
      repeat with evt in events of cal
        if eventCount >= ${maxEvents} then exit repeat

        set evtStart to start date of evt
        if evtStart >= startD and evtStart <= endD then
          set evtTitle to summary of evt

          -- Case-insensitive search in title using variable
          if evtTitle contains searchQuery then
            set evtEnd to end date of evt as string
            set evtLocation to location of evt
            set evtAllDay to allday event of evt

            set evtInfo to "eventTitle:" & evtTitle & "|eventStart:" & (evtStart as string) & "|eventEnd:" & evtEnd & "|eventLocation:" & evtLocation & "|eventCal:" & calName & "|eventAllDay:" & evtAllDay
            set end of eventList to evtInfo
            set eventCount to eventCount + 1
          end if
        end if
      end repeat
    on error
      -- Skip problematic calendars
    end try
  end repeat

  return eventList
end tell`

  logger.debug('Executing search events', { queryLength: query.length, daysBack, daysForward })
  const result = await runAppleScript(script, TIMEOUT_MS.search)

  const events = parseEventsResult(result)
  logger.info('Search events completed', { count: events.length })

  return successResponse({
    events: events.map((event) => ({
      title: event.title,
      startDate: event.startDate,
      endDate: event.endDate,
      location: event.location,
      calendarName: event.calendarName,
      isAllDay: event.isAllDay
    })),
    count: events.length
  })
}

// List upcoming events
// NOTE: We avoid using "whose" clause as it's extremely slow in AppleScript.
// Instead we use "current date" and manual filtering for better performance.
async function listEvents(startDate?: string, endDate?: string, limit?: number): Promise<ToolResponse> {
  const maxEvents = limit || MAX_RESULTS.events

  // Calculate days offset for AppleScript
  let daysBack = 0
  let daysForward = 7

  if (startDate) {
    const start = new Date(startDate)
    if (isNaN(start.getTime())) {
      return errorResponse('Invalid start date format')
    }
    validateDateRange(start)
    const now = new Date()
    // Clamp to non-negative to avoid AppleScript arithmetic issues
    daysBack = Math.max(0, Math.floor((now.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)))
  }

  if (endDate) {
    const end = new Date(endDate)
    if (isNaN(end.getTime())) {
      return errorResponse('Invalid end date format')
    }
    validateDateRange(end)
    const now = new Date()
    // Clamp to non-negative to avoid AppleScript arithmetic issues
    daysForward = Math.max(0, Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)))
  }

  // Use current date and day arithmetic in AppleScript (much faster than date string parsing)
  const script = `
tell application "Calendar"
  set eventList to {}
  set eventCount to 0
  set nowDate to current date
  set startD to nowDate - (${daysBack} * days)
  set endD to nowDate + (${daysForward} * days)

  repeat with cal in calendars
    if eventCount >= ${maxEvents} then exit repeat
    set calName to name of cal

    try
      -- Manual filtering is faster than "whose" clause
      repeat with evt in events of cal
        if eventCount >= ${maxEvents} then exit repeat

        set evtStart to start date of evt
        if evtStart >= startD and evtStart <= endD then
          set evtTitle to summary of evt
          set evtEnd to end date of evt as string
          set evtLocation to location of evt
          set evtAllDay to allday event of evt

          set evtInfo to "eventTitle:" & evtTitle & "|eventStart:" & (evtStart as string) & "|eventEnd:" & evtEnd & "|eventLocation:" & evtLocation & "|eventCal:" & calName & "|eventAllDay:" & evtAllDay
          set end of eventList to evtInfo
          set eventCount to eventCount + 1
        end if
      end repeat
    on error
      -- Skip problematic calendars
    end try
  end repeat

  return eventList
end tell`

  logger.debug('Executing list events', { maxEvents, daysBack, daysForward })
  const result = await runAppleScript(script, TIMEOUT_MS.list)

  const events = parseEventsResult(result)
  logger.info('List events completed', { count: events.length })

  return successResponse({
    events: events.map((event) => ({
      title: event.title,
      startDate: event.startDate,
      endDate: event.endDate,
      location: event.location,
      calendarName: event.calendarName,
      isAllDay: event.isAllDay,
      notes: event.notes ? truncateContent(event.notes, MAX_RESULTS.contentPreview) : null
    })),
    count: events.length
  })
}

// Open Calendar app
async function openCalendar(startDate?: string): Promise<ToolResponse> {
  let script = `
tell application "Calendar"
  activate
`

  if (startDate) {
    const date = new Date(startDate)
    if (isNaN(date.getTime())) {
      return errorResponse('Invalid date format')
    }
    validateDateRange(date)
    const dateStr = formatDateForAppleScript(date.toISOString())

    script += `  view calendar at date "${dateStr}"
`
  }

  script += `end tell`

  logger.debug('Executing open calendar', { hasDate: !!startDate })
  await runAppleScript(script, TIMEOUT_MS.open)

  logger.info('Open calendar completed')

  const message = startDate ? `Calendar app opened to date: ${startDate}` : 'Calendar app opened'

  return successResponse({
    success: true,
    message
  })
}

// Create a new calendar event
async function createEvent(
  title?: string,
  startDate?: string,
  endDate?: string,
  location?: string,
  notes?: string,
  calendar?: string,
  isAllDay?: boolean
): Promise<ToolResponse> {
  if (!title || title.trim() === '') {
    return errorResponse('Event title is required')
  }
  if (!startDate) {
    return errorResponse('Start date is required')
  }

  validateInput(title, MAX_INPUT_LENGTHS.eventTitle, 'Event title')
  const sanitizedTitle = sanitizeAppleScriptString(title)

  // Parse and validate dates
  const startD = new Date(startDate)
  if (isNaN(startD.getTime())) {
    return errorResponse('Invalid start date format')
  }
  validateDateRange(startD)

  let endD = new Date(startD)
  if (endDate) {
    endD = new Date(endDate)
    if (isNaN(endD.getTime())) {
      return errorResponse('Invalid end date format')
    }
    validateDateRange(endD)
  } else {
    // Default: 1 hour after start
    endD.setHours(endD.getHours() + 1)
  }

  if (startD >= endD) {
    return errorResponse('Start date must be before end date')
  }

  const startDateStr = formatDateForAppleScript(startD.toISOString())
  const endDateStr = formatDateForAppleScript(endD.toISOString())

  const sanitizedLocation = location ? sanitizeAppleScriptString(location) : ''
  const sanitizedNotes = notes ? sanitizeAppleScriptString(truncateContent(notes, MAX_INPUT_LENGTHS.noteContent)) : ''
  const targetCalendar = calendar || 'Calendar'
  const sanitizedCalendar = sanitizeAppleScriptString(targetCalendar)
  const allDayFlag = isAllDay ? 'true' : 'false'

  const script = `
tell application "Calendar"
  set targetCal to null
  set calFound to false
  set actualCalName to "${sanitizedCalendar}"

  -- Try to find the specified calendar
  try
    repeat with cal in calendars
      if name of cal is "${sanitizedCalendar}" then
        set targetCal to cal
        set calFound to true
        exit repeat
      end if
    end repeat
  on error
    -- Calendars might not be accessible
  end try

  -- If calendar not found, use default
  if not calFound then
    set targetCal to first calendar whose writable is true
    set actualCalName to name of targetCal
  end if

  -- Create the event
  set newEvent to make new event at targetCal with properties {summary:"${sanitizedTitle}", start date:date "${startDateStr}", end date:date "${endDateStr}", location:"${sanitizedLocation}", description:"${sanitizedNotes}", allday event:${allDayFlag}}

  return "SUCCESS:" & actualCalName
end tell`

  logger.debug('Executing create event', { titleLength: title.length, hasLocation: !!location })
  const result = await runAppleScript(script, TIMEOUT_MS.create)

  // Parse the result
  if (result && result.startsWith('SUCCESS:')) {
    const actualCalendar = result.replace('SUCCESS:', '').trim()
    logger.info('Create event completed', { calendar: actualCalendar })

    return successResponse({
      success: true,
      event: {
        title,
        startDate: startD.toISOString(),
        endDate: endD.toISOString(),
        location: location || null,
        calendarName: actualCalendar,
        isAllDay: isAllDay || false
      },
      message: `Event "${title}" created successfully in calendar "${actualCalendar}"`
    })
  } else {
    return errorResponse(`Failed to create event: ${result || 'Unknown error'}`)
  }
}

// Helper function to parse AppleScript events result
// AppleScript returns pipe-delimited records: "eventTitle:Title|eventStart:Date|..."
function parseEventsResult(result: string): CalendarEvent[] {
  try {
    if (!result || result.trim() === '') {
      return []
    }

    const events: CalendarEvent[] = []

    // Split by "eventTitle:" to separate records (each record is pipe-delimited)
    const parts = result.split(/(?=eventTitle:)/).filter((p) => p.trim())

    for (const part of parts) {
      // Use pipe as delimiter to handle commas in field values
      const titleMatch = part.match(/eventTitle:([^|]+)/)
      const startMatch = part.match(/eventStart:([^|]+)/)
      const endMatch = part.match(/eventEnd:([^|]+)/)
      const locationMatch = part.match(/eventLocation:([^|]*)/)
      const calMatch = part.match(/eventCal:([^|]+)/)
      const allDayMatch = part.match(/eventAllDay:(true|false)/)

      if (titleMatch) {
        const title = titleMatch[1].trim()
        const startDate = startMatch ? startMatch[1].trim() : null
        events.push({
          id: `${title}-${startDate || ''}`,
          title: title || 'Untitled Event',
          startDate,
          endDate: endMatch ? endMatch[1].trim() : null,
          location: locationMatch ? locationMatch[1].trim() || null : null,
          calendarName: calMatch ? calMatch[1].trim() : 'Calendar',
          isAllDay: allDayMatch?.[1] === 'true',
          notes: null,
          url: null
        })
      }
    }

    return events
  } catch (error) {
    logger.error('Failed to parse events result', { error: (error as Error).message })
    return []
  }
}
