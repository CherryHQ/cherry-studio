/**
 * Database Module
 *
 * This module provides centralized access to Drizzle ORM schemas
 * for type-safe database operations.
 *
 * Schema evolution is handled by Drizzle Kit migrations.
 */

// Database Manager (Singleton)
export * from './DatabaseManager'

// Drizzle ORM schemas
export * from './schema'

// Repository helpers
export * from './sessionMessageRepository'

// Migration Service
export * from './MigrationService'
