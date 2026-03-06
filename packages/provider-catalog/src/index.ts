/**
 * Cherry Studio Catalog
 * Main entry point for the model and provider catalog system
 */

// Legacy Zod schemas — still used by packages/shared for runtime type composition
// TODO: migrate packages/shared to define its own schemas, then remove this export
export * from './schemas'

// Protobuf utilities (enum mapping helpers)
export * from './proto-utils'

// Catalog reader (read .pb files and return typed JSON objects)
export { readModelCatalog, readProviderCatalog, readProviderModelCatalog } from './catalog-reader'

// Proto-generated types are available via direct imports:
//   import { ModelCatalogSchema } from '@cherrystudio/provider-catalog/gen/v1/model_pb'
// Not re-exported here to avoid name conflicts with legacy Zod types.
