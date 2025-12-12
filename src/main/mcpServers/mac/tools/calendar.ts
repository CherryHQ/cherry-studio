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

  // Set default date range: today to +30 days
  const now = new Date()
  const defaultStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const defaultEnd = new Date(defaultStart)
  defaultEnd.setDate(defaultEnd.getDate() + 30)

  let startD = defaultStart
  let endD = defaultEnd

  if (startDate) {
    startD = new Date(startDate)
    validateDateRange(startD)
  }

  if (endDate) {
    endD = new Date(endDate)
    validateDateRange(endD)
  }

  if (startD >= endD) {
    return errorResponse('Start date must be before end date')
  }

  const startDateStr = formatDateForAppleScript(startD.toISOString())
  const endDateStr = formatDateForAppleScript(endD.toISOString())

  const script = `
tell application "Calendar"
  set eventList to {}
  set eventCount to 0
  set startD to date "${startDateStr}"
  set endD to date "${endDateStr}"

  repeat with cal in calendars
    set calName to name of cal

    try
      repeat with evt in (events of cal whose start date >= startD and start date <= endD)
        if eventCount >= ${maxEvents} then exit repeat

        set evtTitle to summary of evt
        set evtContent to description of evt

        -- Case-insensitive search in title and description
        if (evtTitle contains "${sanitizedQuery}") or (evtContent contains "${sanitizedQuery}") then
          set evtStart to start date of evt as string
          set evtEnd to end date of evt as string
          set evtLocation to location of evt
          set evtAllDay to allday event of evt

          set evtInfo to {eventTitle:evtTitle, eventStart:evtStart, eventEnd:evtEnd, eventLocation:evtLocation, eventCal:calName, eventAllDay:evtAllDay, eventNotes:evtContent}
          set end of eventList to evtInfo
          set eventCount to eventCount + 1
        end if
      end repeat
    on error
      -- Skip problematic calendars
    end try

    if eventCount >= ${maxEvents} then exit repeat
  end repeat

  return eventList
end tell`

  logger.debug('Executing search events', { queryLength: query.length })
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
      isAllDay: event.isAllDay,
      notes: event.notes ? truncateContent(event.notes, MAX_RESULTS.contentPreview) : null
    })),
    count: events.length
  })
}

// List upcoming events
async function listEvents(startDate?: string, endDate?: string, limit?: number): Promise<ToolResponse> {
  const maxEvents = limit || MAX_RESULTS.events

  // Default: next 7 days
  const now = new Date()
  const defaultStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const defaultEnd = new Date(defaultStart)
  defaultEnd.setDate(defaultEnd.getDate() + 7)

  let startD = defaultStart
  let endD = defaultEnd

  if (startDate) {
    startD = new Date(startDate)
    validateDateRange(startD)
  }

  if (endDate) {
    endD = new Date(endDate)
    validateDateRange(endD)
  }

  if (startD >= endD) {
    return errorResponse('Start date must be before end date')
  }

  const startDateStr = formatDateForAppleScript(startD.toISOString())
  const endDateStr = formatDateForAppleScript(endD.toISOString())

  const script = `
tell application "Calendar"
  set eventList to {}
  set eventCount to 0
  set startD to date "${startDateStr}"
  set endD to date "${endDateStr}"

  repeat with cal in calendars
    set calName to name of cal

    try
      repeat with evt in (events of cal whose start date >= startD and start date <= endD)
        if eventCount >= ${maxEvents} then exit repeat

        set evtTitle to summary of evt
        set evtStart to start date of evt as string
        set evtEnd to end date of evt as string
        set evtLocation to location of evt
        set evtAllDay to allday event of evt
        set evtContent to description of evt

        set evtInfo to {eventTitle:evtTitle, eventStart:evtStart, eventEnd:evtEnd, eventLocation:evtLocation, eventCal:calName, eventAllDay:evtAllDay, eventNotes:evtContent}
        set end of eventList to evtInfo
        set eventCount to eventCount + 1
      end repeat
    on error
      -- Skip problematic calendars
    end try

    if eventCount >= ${maxEvents} then exit repeat
  end repeat

  return eventList
end tell`

  logger.debug('Executing list events', { maxEvents })
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
  validateDateRange(startD)

  let endD = new Date(startD)
  if (endDate) {
    endD = new Date(endDate)
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
function parseEventsResult(result: string): CalendarEvent[] {
  try {
    if (!result || result.trim() === '') {
      return []
    }

    const events: CalendarEvent[] = []

    // Pattern to match event records
    const recordPattern =
      /\{eventTitle:"([^"]*)", eventStart:"([^"]*)", eventEnd:"([^"]*)", eventLocation:"([^"]*)", eventCal:"([^"]*)", eventAllDay:(true|false), eventNotes:"([^"]*)"\}/g
    let match

    while ((match = recordPattern.exec(result)) !== null) {
      events.push({
        id: `${match[1]}-${match[2]}`, // Simple ID from title + startDate
        title: match[1] || 'Untitled Event',
        startDate: match[2] || null,
        endDate: match[3] || null,
        location: match[4] || null,
        calendarName: match[5] || 'Calendar',
        isAllDay: match[6] === 'true',
        notes: match[7] || null,
        url: null
      })
    }

    // If no matches found, try simple parsing for single record
    if (events.length === 0 && result.includes('eventTitle:')) {
      const titleMatch = result.match(/eventTitle:"([^"]*)"/)
      const startMatch = result.match(/eventStart:"([^"]*)"/)
      const endMatch = result.match(/eventEnd:"([^"]*)"/)
      const locationMatch = result.match(/eventLocation:"([^"]*)"/)
      const calMatch = result.match(/eventCal:"([^"]*)"/)
      const allDayMatch = result.match(/eventAllDay:(true|false)/)
      const notesMatch = result.match(/eventNotes:"([^"]*)"/)

      if (titleMatch) {
        events.push({
          id: `${titleMatch[1]}-${startMatch?.[1] || ''}`,
          title: titleMatch[1] || 'Untitled Event',
          startDate: startMatch?.[1] || null,
          endDate: endMatch?.[1] || null,
          location: locationMatch?.[1] || null,
          calendarName: calMatch?.[1] || 'Calendar',
          isAllDay: allDayMatch?.[1] === 'true',
          notes: notesMatch?.[1] || null,
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
