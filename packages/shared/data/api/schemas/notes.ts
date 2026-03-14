/**
 * Note API Schema definitions
 *
 * Manages note file metadata stored in SQLite.
 * Notes are identified by relativePath (relative to notesRoot preference).
 * Currently supports starred status; extensible for future fields.
 */

// ============================================================================
// Domain Models & DTOs
// ============================================================================

export interface Note {
  id: string
  relativePath: string
  isStarred: boolean
  createdAt: string
  updatedAt: string
}

export interface UpdateNoteDto {
  isStarred?: boolean
}

// ============================================================================
// API Schema Definitions
// ============================================================================

export interface NoteSchemas {
  '/notes': {
    /** List all notes with metadata */
    GET: {
      response: Note[]
    }
  }
  '/notes/:relativePath': {
    /** Get or create note metadata by relativePath */
    GET: {
      params: { relativePath: string }
      response: Note
    }
    /** Update note metadata (e.g. starred status) */
    PATCH: {
      params: { relativePath: string }
      body: UpdateNoteDto
      response: Note
    }
    /** Delete note metadata */
    DELETE: {
      params: { relativePath: string }
      response: void
    }
  }
}
