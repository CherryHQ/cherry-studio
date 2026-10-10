/**
 * Serializable type.
 *
 * The runtime guard `isSerializable` and the `SerializableSchema` Zod schema
 * live in `@shared/utils/serializable`.
 */
export type Serializable = string | number | boolean | null | Serializable[] | { [key: string]: Serializable }
