/**
 * Agents Service Module
 *
 * This module provides a complete autonomous agent management system with:
 * - Agent lifecycle management (CRUD operations)
 * - Session handling with conversation history
 * - Comprehensive logging and audit trails
 * - Database operations with Drizzle ORM and migration support
 * - RESTful API endpoints for external integration
 */

// === Core Services ===
// Main service classes and singleton instances
export * from './services'

// === Error Types ===
export { type AgentModelField, AgentModelValidationError } from './errors'

// === Base Infrastructure ===
// Shared database utilities and base service class
export { BaseService } from './BaseService'

// === Tool Environment Utilities ===
// Utilities for filtering tools based on runtime environment
export {
  filterToolsByEnvironment,
  getBuiltinTools,
  getDisabledBuiltinToolIds,
  getSupportedToolIds,
  getUnsupportedToolIds,
  isToolSupportedInEnvironment,
  partitionToolsByEnvironment
} from './services/claudecode/tool-environment'

// === Database Layer ===
// Drizzle ORM schemas, migrations, and database utilities
export * as Database from './database'
