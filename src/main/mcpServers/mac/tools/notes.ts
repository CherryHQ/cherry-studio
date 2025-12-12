import { loggerService } from '@logger'
import {
  MAX_INPUT_LENGTHS,
  MAX_RESULTS,
  runAppleScript,
  sanitizeAppleScriptString,
  TIMEOUT_MS,
  validateInput
} from '../applescript'
import type { CreateNoteResult, Note, NotesArgs, ToolResponse } from '../types'
import { NotesArgsSchema } from '../types'
import { errorResponse, handleAppleScriptError, successResponse, truncateContent } from './utils'

const logger = loggerService.withContext('MacMCP')

// Tool definition for MCP
export const notesToolDefinition = {
  name: 'notes',
  description:
    'Interact with Apple Notes app. Operations: search (find notes by query), list (get all notes), create (make new note). Requires macOS Automation permission.',
  inputSchema: {
    type: 'object',
    properties: {
      operation: {
        type: 'string',
        enum: ['search', 'list', 'create'],
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
      title: {
        type: 'string',
        description: 'Note title (for create operation)'
      },
      body: {
        type: 'string',
        description: 'Note body content (for create operation)'
      },
      folder: {
        type: 'string',
        description: 'Folder name (for create operation, defaults to Notes)'
      }
    },
    required: ['operation']
  }
}

// Handler function
export async function handleNotes(args: unknown): Promise<ToolResponse> {
  const parsed = NotesArgsSchema.safeParse(args)
  if (!parsed.success) {
    return errorResponse(`Invalid arguments: ${parsed.error.message}`)
  }

  const { operation, query, limit, title, body, folder } = parsed.data
  logger.info('Notes tool called', { operation })

  try {
    switch (operation) {
      case 'search':
        return await searchNotes(query, limit)
      case 'list':
        return await listNotes(limit)
      case 'create':
        return await createNote(title, body, folder)
      default:
        return errorResponse(`Unknown operation: ${operation}`)
    }
  } catch (error) {
    return handleAppleScriptError(error, 'Notes', operation)
  }
}

// Search notes by query
async function searchNotes(query?: string, limit?: number): Promise<ToolResponse> {
  if (!query || query.trim() === '') {
    return errorResponse('Search query is required')
  }

  validateInput(query, MAX_INPUT_LENGTHS.searchQuery, 'Search query')
  const sanitizedQuery = sanitizeAppleScriptString(query.toLowerCase())
  const maxNotes = limit || MAX_RESULTS.notes

  const script = `
tell application "Notes"
  set matchingNotes to {}
  set noteCount to 0

  -- Get all notes and search through them
  set allNotes to notes

  repeat with i from 1 to (count of allNotes)
    if noteCount >= ${maxNotes} then exit repeat

    try
      set currentNote to item i of allNotes
      set noteName to name of currentNote
      set noteContent to plaintext of currentNote
      set noteFolder to name of container of currentNote

      -- Simple case-insensitive search in name and content
      if (noteName contains "${sanitizedQuery}") or (noteContent contains "${sanitizedQuery}") then
        -- Limit content for preview
        if (length of noteContent) > ${MAX_RESULTS.contentPreview} then
          set noteContent to (characters 1 thru ${MAX_RESULTS.contentPreview} of noteContent) as string
          set noteContent to noteContent & "..."
        end if

        set noteInfo to {noteName:noteName, noteContent:noteContent, noteFolder:noteFolder}
        set end of matchingNotes to noteInfo
        set noteCount to noteCount + 1
      end if
    on error
      -- Skip problematic notes
    end try
  end repeat

  return matchingNotes
end tell`

  logger.debug('Executing search notes', { queryLength: query.length })
  const result = await runAppleScript(script, TIMEOUT_MS.search)

  // Parse the AppleScript result
  const notes = parseNotesResult(result)
  logger.info('Search notes completed', { count: notes.length })

  return successResponse({
    notes: notes.map((note) => ({
      name: note.name,
      content: truncateContent(note.content, MAX_RESULTS.contentPreview),
      folder: note.folder
    })),
    count: notes.length
  })
}

// List all notes with limit
async function listNotes(limit?: number): Promise<ToolResponse> {
  const maxNotes = limit || MAX_RESULTS.notes

  const script = `
tell application "Notes"
  set notesList to {}
  set noteCount to 0

  -- Get all notes from all folders
  set allNotes to notes

  repeat with i from 1 to (count of allNotes)
    if noteCount >= ${maxNotes} then exit repeat

    try
      set currentNote to item i of allNotes
      set noteName to name of currentNote
      set noteContent to plaintext of currentNote
      set noteFolder to name of container of currentNote

      -- Limit content for preview
      if (length of noteContent) > ${MAX_RESULTS.contentPreview} then
        set noteContent to (characters 1 thru ${MAX_RESULTS.contentPreview} of noteContent) as string
        set noteContent to noteContent & "..."
      end if

      set noteInfo to {noteName:noteName, noteContent:noteContent, noteFolder:noteFolder}
      set end of notesList to noteInfo
      set noteCount to noteCount + 1
    on error
      -- Skip problematic notes
    end try
  end repeat

  return notesList
end tell`

  logger.debug('Executing list notes', { maxNotes })
  const result = await runAppleScript(script, TIMEOUT_MS.list)

  // Parse the AppleScript result
  const notes = parseNotesResult(result)
  logger.info('List notes completed', { count: notes.length })

  return successResponse({
    notes: notes.map((note) => ({
      name: note.name,
      content: truncateContent(note.content, MAX_RESULTS.contentPreview),
      folder: note.folder
    })),
    count: notes.length
  })
}

// Create a new note
async function createNote(
  title?: string,
  body?: string,
  folder?: string
): Promise<ToolResponse> {
  if (!title || title.trim() === '') {
    return errorResponse('Note title is required')
  }
  if (!body || body.trim() === '') {
    return errorResponse('Note body is required')
  }

  validateInput(title, MAX_INPUT_LENGTHS.noteTitle, 'Note title')
  validateInput(body, MAX_INPUT_LENGTHS.noteContent, 'Note body')

  const sanitizedTitle = sanitizeAppleScriptString(title)
  const sanitizedBody = sanitizeAppleScriptString(body)
  const targetFolder = folder || 'Notes'
  const sanitizedFolder = sanitizeAppleScriptString(targetFolder)

  const script = `
tell application "Notes"
  set targetFolder to null
  set folderFound to false
  set actualFolderName to "${sanitizedFolder}"

  -- Try to find the specified folder
  try
    set allFolders to folders
    repeat with currentFolder in allFolders
      if name of currentFolder is "${sanitizedFolder}" then
        set targetFolder to currentFolder
        set folderFound to true
        exit repeat
      end if
    end repeat
  on error
    -- Folders might not be accessible
  end try

  -- If folder not found, use default
  if not folderFound then
    set actualFolderName to "Notes"
  end if

  -- Create the note
  if folderFound and targetFolder is not null then
    make new note at targetFolder with properties {name:"${sanitizedTitle}", body:"${sanitizedBody}"}
  else
    make new note with properties {name:"${sanitizedTitle}", body:"${sanitizedBody}"}
  end if

  return "SUCCESS:" & actualFolderName
end tell`

  logger.debug('Executing create note', { titleLength: title.length, bodyLength: body.length })
  const result = await runAppleScript(script, TIMEOUT_MS.create)

  // Parse the result
  if (result && result.startsWith('SUCCESS:')) {
    const actualFolder = result.replace('SUCCESS:', '').trim()
    logger.info('Create note completed', { folder: actualFolder })

    const response: CreateNoteResult = {
      success: true,
      note: {
        name: title,
        folder: actualFolder
      },
      message: `Note "${title}" created successfully in folder "${actualFolder}"`
    }

    return successResponse(response)
  } else {
    return errorResponse(`Failed to create note: ${result || 'Unknown error'}`)
  }
}

// Helper function to parse AppleScript notes result
function parseNotesResult(result: string): Note[] {
  try {
    // AppleScript returns record format like: {noteName:"...", noteContent:"...", noteFolder:"..."}
    // We need to parse this into JSON format

    if (!result || result.trim() === '') {
      return []
    }

    const notes: Note[] = []

    // Remove outer braces if present
    let content = result.trim()
    if (content.startsWith('{') && content.endsWith('}')) {
      content = content.slice(1, -1)
    }

    // Split by record boundaries (looking for patterns like "}, {")
    const recordPattern = /\{noteName:"([^"]*)", noteContent:"([^"]*)", noteFolder:"([^"]*)"\}/g
    let match

    while ((match = recordPattern.exec(result)) !== null) {
      notes.push({
        name: match[1] || 'Untitled Note',
        content: match[2] || '',
        folder: match[3] || 'Notes'
      })
    }

    // If no matches found, try simple parsing
    if (notes.length === 0 && content.includes('noteName:')) {
      const nameMatch = content.match(/noteName:"([^"]*)"/)
      const contentMatch = content.match(/noteContent:"([^"]*)"/)
      const folderMatch = content.match(/noteFolder:"([^"]*)"/)

      if (nameMatch) {
        notes.push({
          name: nameMatch[1] || 'Untitled Note',
          content: contentMatch?.[1] || '',
          folder: folderMatch?.[1] || 'Notes'
        })
      }
    }

    return notes
  } catch (error) {
    logger.error('Failed to parse notes result', { error: (error as Error).message })
    return []
  }
}
