import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { createUpdateTimestamps } from './_columnHelpers'

/**
 * WebSearch Provider table - stores web search provider configurations
 *
 * Providers can be API-based (e.g., Tavily, SearxNG) or local browser-based.
 * API providers use apiKey/apiHost for authentication.
 * Local providers use apiHost as URL template with %s placeholder.
 */
export const websearchProviderTable = sqliteTable('websearch_provider', {
  // User-specified unique identifier (e.g., 'tavily', 'searxng', 'local-google')
  id: text().primaryKey(),
  // Display name
  name: text().notNull(),
  // Provider type: 'api' | 'local'
  type: text().notNull(),
  // API key (for API type providers)
  apiKey: text(),
  // API host URL or URL template with %s placeholder (for local type)
  apiHost: text(),
  // Search engines list as JSON array (for SearxNG)
  engines: text({ mode: 'json' }).$type<string[]>(),
  // Whether to use browser for fetching (for local type)
  usingBrowser: integer({ mode: 'boolean' }).default(false),
  // HTTP Basic Auth username (for SearxNG)
  basicAuthUsername: text(),
  // HTTP Basic Auth password (for SearxNG)
  basicAuthPassword: text(),

  ...createUpdateTimestamps
})
