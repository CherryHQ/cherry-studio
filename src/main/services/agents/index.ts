/**
 * Agents Service Module
 *
 * This module provides a complete autonomous agent management system with:
 * - Agent lifecycle management (CRUD operations)
 * - Session handling with conversation history
 * - Comprehensive logging and audit trails
 * - Database operations with migration support
 * - RESTful API endpoints for external integration
 */

// === Core Services ===
// Main service classes and singleton instances
export * from './services'

// === Base Infrastructure ===
// Shared database utilities and base service class
export { BaseService } from './BaseService'

// === Database Layer ===
// New modular database structure (recommended for new code)
export * as Database from './database'

// === Legacy Compatibility ===
// Backward compatibility layer - use Database exports for new code
export { AgentQueries_Legacy as AgentQueries } from './database'

// === Type Re-exports ===
// Main service types are available through service exports
