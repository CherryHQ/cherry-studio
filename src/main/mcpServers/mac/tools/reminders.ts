import { loggerService } from '@logger'

import {
  MAX_INPUT_LENGTHS,
  MAX_RESULTS,
  runAppleScript,
  sanitizeAppleScriptString,
  TIMEOUT_MS,
  validateInput
} from '../applescript'
import type { Reminder, ReminderList, ToolResponse } from '../types'
import { RemindersArgsSchema } from '../types'
import { errorResponse, handleAppleScriptError, successResponse, truncateContent } from './utils'

const logger = loggerService.withContext('MacMCP')

// Tool definition for MCP
export const remindersToolDefinition = {
  name: 'reminders',
  description:
    'Interact with Apple Reminders app. Operations: list (get all reminder lists), search (find reminders by query), open (open app), create (make new reminder), listById (get reminders from a specific list). Requires macOS Automation permission.',
  inputSchema: {
    type: 'object',
    properties: {
      operation: {
        type: 'string',
        enum: ['list', 'search', 'open', 'create', 'listById'],
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
      listId: {
        type: 'string',
        description: 'List ID or name (for listById operation)'
      },
      listName: {
        type: 'string',
        description: 'Reminder list name (for create operation)'
      },
      name: {
        type: 'string',
        description: 'Reminder name (for create operation)'
      },
      body: {
        type: 'string',
        description: 'Reminder body/notes (for create operation)'
      },
      dueDate: {
        type: 'string',
        description: 'Due date ISO string (for create operation)'
      }
    },
    required: ['operation']
  }
}

// Handler function
export async function handleReminders(args: unknown): Promise<ToolResponse> {
  const parsed = RemindersArgsSchema.safeParse(args)
  if (!parsed.success) {
    return errorResponse(`Invalid arguments: ${parsed.error.message}`)
  }

  const { operation, ...rest } = parsed.data
  logger.info('Reminders tool called', { operation })

  try {
    switch (operation) {
      case 'list':
        return await listReminderLists(rest.limit)
      case 'search':
        return await searchReminders(rest.query, rest.limit)
      case 'open':
        return await openReminders()
      case 'create':
        return await createReminder(rest.listName, rest.name, rest.body, rest.dueDate)
      case 'listById':
        return await getRemindersFromList(rest.listId, rest.limit)
      default:
        return errorResponse(`Unknown operation: ${operation}`)
    }
  } catch (error) {
    return handleAppleScriptError(error, 'Reminders', operation)
  }
}

// List all reminder lists
async function listReminderLists(limit?: number): Promise<ToolResponse> {
  const maxLists = limit || MAX_RESULTS.reminders

  const script = `
tell application "Reminders"
  set listsList to {}
  set listCount to 0

  set allLists to lists

  repeat with i from 1 to (count of allLists)
    if listCount >= ${maxLists} then exit repeat

    try
      set currentList to item i of allLists
      set listName to name of currentList
      set listId to id of currentList

      -- Use pipe delimiter to handle commas in names
      set listInfo to "listName:" & listName & "|listId:" & listId
      set end of listsList to listInfo
      set listCount to listCount + 1
    on error
      -- Skip problematic lists
    end try
  end repeat

  return listsList
end tell`

  logger.debug('Executing list reminder lists', { maxLists })
  const result = await runAppleScript(script, TIMEOUT_MS.list)

  const lists = parseReminderListsResult(result)
  logger.info('List reminder lists completed', { count: lists.length })

  return successResponse({
    lists: lists.map((list) => ({
      name: list.name,
      id: list.id
    })),
    count: lists.length
  })
}

// Search reminders by query
async function searchReminders(query?: string, limit?: number): Promise<ToolResponse> {
  if (!query || query.trim() === '') {
    return errorResponse('Search query is required')
  }

  validateInput(query, MAX_INPUT_LENGTHS.searchQuery, 'Search query')
  const sanitizedQuery = sanitizeAppleScriptString(query.toLowerCase())
  const maxReminders = limit || MAX_RESULTS.reminders

  const script = `
tell application "Reminders"
  set matchingReminders to {}
  set reminderCount to 0
  set searchQuery to "${sanitizedQuery}"

  set allLists to lists

  repeat with currentList in allLists
    set listName to name of currentList

    try
      set allReminders to reminders of currentList

      repeat with currentReminder in allReminders
        if reminderCount >= ${maxReminders} then exit repeat

        set reminderName to name of currentReminder
        set reminderBody to body of currentReminder
        set reminderCompleted to completed of currentReminder
        set reminderId to id of currentReminder

        -- Handle missing value for dueDate
        try
          set reminderDue to due date of currentReminder
          if reminderDue is missing value then
            set reminderDueStr to ""
          else
            set reminderDueStr to reminderDue as string
          end if
        on error
          set reminderDueStr to ""
        end try

        -- Case-insensitive search in name and body using variable
        if (reminderName contains searchQuery) or (reminderBody contains searchQuery) then
          -- Use pipe delimiter to handle commas in content
          set reminderInfo to "reminderName:" & reminderName & "|reminderBody:" & reminderBody & "|reminderCompleted:" & reminderCompleted & "|reminderDue:" & reminderDueStr & "|reminderList:" & listName & "|reminderId:" & reminderId
          set end of matchingReminders to reminderInfo
          set reminderCount to reminderCount + 1
        end if
      end repeat
    on error
      -- Skip problematic lists
    end try

    if reminderCount >= ${maxReminders} then exit repeat
  end repeat

  return matchingReminders
end tell`

  logger.debug('Executing search reminders', { queryLength: query.length })
  const result = await runAppleScript(script, TIMEOUT_MS.search)

  const reminders = parseRemindersResult(result)
  logger.info('Search reminders completed', { count: reminders.length })

  return successResponse({
    reminders: reminders.map((reminder) => ({
      name: reminder.name,
      id: reminder.id,
      body: reminder.body ? truncateContent(reminder.body, MAX_RESULTS.contentPreview) : null,
      completed: reminder.completed,
      dueDate: reminder.dueDate,
      listName: reminder.listName
    })),
    count: reminders.length
  })
}

// Open Reminders app
async function openReminders(): Promise<ToolResponse> {
  const script = `
tell application "Reminders"
  activate
end tell`

  logger.debug('Executing open reminders')
  await runAppleScript(script, TIMEOUT_MS.open)

  logger.info('Open reminders completed')

  return successResponse({
    success: true,
    message: 'Reminders app opened'
  })
}

// Create a new reminder
async function createReminder(
  listName?: string,
  name?: string,
  body?: string,
  dueDate?: string
): Promise<ToolResponse> {
  if (!name || name.trim() === '') {
    return errorResponse('Reminder name is required')
  }

  validateInput(name, MAX_INPUT_LENGTHS.reminderName, 'Reminder name')
  const sanitizedName = sanitizeAppleScriptString(name)

  const sanitizedBody = body ? sanitizeAppleScriptString(truncateContent(body, MAX_INPUT_LENGTHS.noteContent)) : ''

  const targetList = listName || 'Reminders'
  const sanitizedList = sanitizeAppleScriptString(targetList)

  let dueDateScript = ''
  if (dueDate) {
    const date = new Date(dueDate)
    if (isNaN(date.getTime())) {
      return errorResponse('Invalid due date format')
    }
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
    const dateStr = date.toLocaleString('en-US', options)
    dueDateScript = `, due date:date "${dateStr}"`
  }

  const script = `
tell application "Reminders"
  set targetList to null
  set listFound to false
  set actualListName to "${sanitizedList}"

  -- Try to find the specified list
  try
    set allLists to lists
    repeat with currentList in allLists
      if name of currentList is "${sanitizedList}" then
        set targetList to currentList
        set listFound to true
        exit repeat
      end if
    end repeat
  on error
    -- Lists might not be accessible
  end try

  -- If list not found, use default
  if not listFound then
    set targetList to first list
    set actualListName to name of targetList
  end if

  -- Create the reminder
  make new reminder at targetList with properties {name:"${sanitizedName}", body:"${sanitizedBody}"${dueDateScript}}

  return "SUCCESS:" & actualListName
end tell`

  logger.debug('Executing create reminder', { nameLength: name.length, hasBody: !!body })
  const result = await runAppleScript(script, TIMEOUT_MS.create)

  // Parse the result
  if (result && result.startsWith('SUCCESS:')) {
    const actualList = result.replace('SUCCESS:', '').trim()
    logger.info('Create reminder completed', { list: actualList })

    return successResponse({
      success: true,
      reminder: {
        name,
        listName: actualList,
        body: body || null,
        dueDate: dueDate || null
      },
      message: `Reminder "${name}" created successfully in list "${actualList}"`
    })
  } else {
    return errorResponse(`Failed to create reminder: ${result || 'Unknown error'}`)
  }
}

// Get reminders from a specific list by ID or name
async function getRemindersFromList(listId?: string, limit?: number): Promise<ToolResponse> {
  if (!listId || listId.trim() === '') {
    return errorResponse('List ID or name is required')
  }

  validateInput(listId, MAX_INPUT_LENGTHS.searchQuery, 'List ID')
  const sanitizedListId = sanitizeAppleScriptString(listId)
  const maxReminders = limit || MAX_RESULTS.reminders

  const script = `
tell application "Reminders"
  set remindersList to {}
  set reminderCount to 0
  set targetList to null
  set listFound to false
  set searchListId to "${sanitizedListId}"

  -- Try to find the list by ID or name using variable
  set allLists to lists
  repeat with currentList in allLists
    if (id of currentList is searchListId) or (name of currentList is searchListId) then
      set targetList to currentList
      set listFound to true
      exit repeat
    end if
  end repeat

  if not listFound then
    return "ERROR:List not found"
  end if

  set listName to name of targetList
  set allReminders to reminders of targetList

  repeat with i from 1 to (count of allReminders)
    if reminderCount >= ${maxReminders} then exit repeat

    try
      set currentReminder to item i of allReminders
      set reminderName to name of currentReminder
      set reminderBody to body of currentReminder
      set reminderCompleted to completed of currentReminder
      set reminderId to id of currentReminder

      -- Handle missing value for dueDate
      try
        set reminderDue to due date of currentReminder
        if reminderDue is missing value then
          set reminderDueStr to ""
        else
          set reminderDueStr to reminderDue as string
        end if
      on error
        set reminderDueStr to ""
      end try

      -- Use pipe delimiter to handle commas in content
      set reminderInfo to "reminderName:" & reminderName & "|reminderBody:" & reminderBody & "|reminderCompleted:" & reminderCompleted & "|reminderDue:" & reminderDueStr & "|reminderList:" & listName & "|reminderId:" & reminderId
      set end of remindersList to reminderInfo
      set reminderCount to reminderCount + 1
    on error
      -- Skip problematic reminders
    end try
  end repeat

  return remindersList
end tell`

  logger.debug('Executing get reminders from list', { listId })
  const result = await runAppleScript(script, TIMEOUT_MS.list)

  // Check for error
  if (result && result.startsWith('ERROR:')) {
    const errorMsg = result.replace('ERROR:', '').trim()
    return errorResponse(errorMsg)
  }

  const reminders = parseRemindersResult(result)
  logger.info('Get reminders from list completed', { count: reminders.length })

  return successResponse({
    reminders: reminders.map((reminder) => ({
      name: reminder.name,
      id: reminder.id,
      body: reminder.body ? truncateContent(reminder.body, MAX_RESULTS.contentPreview) : null,
      completed: reminder.completed,
      dueDate: reminder.dueDate,
      listName: reminder.listName
    })),
    count: reminders.length
  })
}

// Helper function to parse AppleScript reminder lists result
// AppleScript returns pipe-delimited records: "listName:Name|listId:ID"
function parseReminderListsResult(result: string): ReminderList[] {
  try {
    if (!result || result.trim() === '') {
      return []
    }

    const lists: ReminderList[] = []

    // Split by "listName:" to separate records (each record is pipe-delimited)
    const parts = result.split(/(?=listName:)/).filter((p) => p.trim())

    for (const part of parts) {
      // Use pipe as delimiter to handle commas in field values
      const nameMatch = part.match(/listName:([^|]+)/)
      const idMatch = part.match(/listId:([^|,}]+)/)

      if (nameMatch) {
        lists.push({
          name: nameMatch[1].trim() || 'Untitled List',
          id: idMatch ? idMatch[1].trim() : ''
        })
      }
    }

    return lists
  } catch (error) {
    logger.error('Failed to parse reminder lists result', { error: (error as Error).message })
    return []
  }
}

// Helper function to parse AppleScript reminders result
// AppleScript returns pipe-delimited records: "reminderName:Name|reminderBody:Body|..."
function parseRemindersResult(result: string): Reminder[] {
  try {
    if (!result || result.trim() === '') {
      return []
    }

    const reminders: Reminder[] = []

    // Split by "reminderName:" to separate records (each record is pipe-delimited)
    const parts = result.split(/(?=reminderName:)/).filter((p) => p.trim())

    for (const part of parts) {
      // Use pipe as delimiter to handle commas in field values
      const nameMatch = part.match(/reminderName:([^|]+)/)
      const bodyMatch = part.match(/reminderBody:([^|]*)/)
      const completedMatch = part.match(/reminderCompleted:(true|false)/)
      const dueMatch = part.match(/reminderDue:([^|]*)/)
      const listMatch = part.match(/reminderList:([^|]+)/)
      const idMatch = part.match(/reminderId:([^|,}]+)/)

      if (nameMatch) {
        reminders.push({
          name: nameMatch[1].trim() || 'Untitled Reminder',
          body: bodyMatch ? bodyMatch[1].trim() : '',
          completed: completedMatch?.[1] === 'true',
          dueDate: dueMatch ? dueMatch[1].trim() || null : null,
          listName: listMatch ? listMatch[1].trim() : 'Reminders',
          id: idMatch ? idMatch[1].trim() : ''
        })
      }
    }

    return reminders
  } catch (error) {
    logger.error('Failed to parse reminders result', { error: (error as Error).message })
    return []
  }
}
