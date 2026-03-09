/**
 * Note API Schema definitions
 *
 * Manages note file metadata stored in SQLite.
 * Currently supports starred status; extensible for future fields.
 */

// ============================================================================
// Domain Models & DTOs
// ============================================================================

export interface Note {
  id: string
  path: string
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
  '/notes/:path': {
    /** Get or create note metadata by path */
    GET: {
      params: { path: string }
      response: Note
    }
    /** Update note metadata (e.g. starred status) */
    PATCH: {
      params: { path: string }
      body: UpdateNoteDto
      response: Note
    }
    /** Delete note metadata */
    DELETE: {
      params: { path: string }
      response: void
    }
  }
}
