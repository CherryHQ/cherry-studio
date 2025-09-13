/**
 * SQL queries for Session Message operations
 */

export const SessionMessageQueries = {
  // CREATE
  insert: `
    INSERT INTO session_logs (session_id, parent_id, role, type, content, metadata, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `,

  // READ
  getById: `
    SELECT * FROM session_logs
    WHERE id = ?
  `,

  getBySessionId: `
    SELECT * FROM session_logs
    WHERE session_id = ?
    ORDER BY created_at ASC, id ASC
  `,

  getBySessionIdWithPagination: `
    SELECT * FROM session_logs
    WHERE session_id = ?
    ORDER BY created_at ASC, id ASC
    LIMIT ? OFFSET ?
  `,

  getLatestBySessionId: `
    SELECT * FROM session_logs
    WHERE session_id = ?
    ORDER BY created_at DESC, id DESC
    LIMIT ?
  `,

  // UPDATE
  update: `
    UPDATE session_logs
    SET content = ?, metadata = ?, updated_at = ?
    WHERE id = ?
  `,

  // DELETE
  deleteById: 'DELETE FROM session_logs WHERE id = ?',

  deleteBySessionId: 'DELETE FROM session_logs WHERE session_id = ?',

  // COUNT
  countBySessionId: 'SELECT COUNT(*) as total FROM session_logs WHERE session_id = ?'
} as const
