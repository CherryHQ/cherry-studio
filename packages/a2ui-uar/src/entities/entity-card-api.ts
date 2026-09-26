import { AccessibilityAttributesSchema, ActionSchema, DynamicStringSchema } from '@prometheus-ags/a2ui-core/v0_9'
import * as z from 'zod'

/**
 * `EntityCard` — a UAR-specific A2UI component (not part of the
 * `uar.a2ui/1` 9-component protocol baseline) for rendering a single
 * entity record inline in an agent surface.
 *
 * This is a *new*, protocol-native component — Change 17 does not migrate
 * `@prometheus-ags/prometheus-entity-management`'s existing React
 * components (that is Change 18's job, `a2ui-entity-component-migration`
 * per the phase plan). What this schema *does* do is mirror
 * `prometheus-entity-management`'s established naming
 * (`frontend/packages/prometheus-entity-management/src/graph.ts`):
 * `entityType: EntityType` (a string), `entityId: EntityId` (a string),
 * and the `$synced` / `$origin` / `$updatedAt` sync-metadata field names
 * from `EntitySnapshot<T>`. Change 18 can then re-home the *rendering*
 * logic from that package's entity views into a component like this one
 * without renaming every field the two systems use to talk about "an
 * entity."
 *
 * Every value that can vary at runtime (title, subtitle, field values,
 * sync origin, action labels) is a `DynamicString` so it can be bound to
 * the A2UI data model like any other component — an agent can point this
 * card at `/entities/order-123` and have it re-render reactively as that
 * path's data changes, exactly like `Text` or `TextField` do.
 */
export const EntityCardApi = {
  name: 'EntityCard',
  schema: z
    .object({
      accessibility: AccessibilityAttributesSchema.optional(),
      weight: z.number().optional(),
      /** The entity's logical kind, e.g. `"Order"` — mirrors `EntityType` in prometheus-entity-management. Static: the shape of a card is determined by its type, not runtime data. */
      entityType: z
        .string()
        .describe("The entity's logical kind (e.g. 'Order'), mirroring EntityType in prometheus-entity-management."),
      /** The entity's primary key — mirrors `EntityId`. */
      entityId: DynamicStringSchema.describe(
        "The entity's primary key, mirroring EntityId in prometheus-entity-management."
      ),
      title: DynamicStringSchema.describe("The card's primary heading — typically the entity's display name."),
      subtitle: DynamicStringSchema.describe('Secondary text shown under the title.').optional(),
      fields: z
        .array(
          z
            .object({
              label: DynamicStringSchema,
              value: DynamicStringSchema
            })
            .strict()
        )
        .describe('Label/value pairs rendered as a definition list inside the card.')
        .optional(),
      /** Mirrors `EntitySyncMetadata.origin` (`"server" | "client" | "optimistic"`). */
      syncOrigin: z
        .enum(['server', 'client', 'optimistic'])
        .describe(
          'Mirrors EntitySyncMetadata.origin — surfaced as a badge so a user can tell an optimistic/unconfirmed card apart from a server-confirmed one.'
        )
        .optional(),
      actions: z
        .array(
          z
            .object({
              label: DynamicStringSchema,
              action: ActionSchema
            })
            .strict()
        )
        .describe('Zero or more action buttons rendered in the card footer.')
        .optional()
    })
    .strict()
    .describe(
      'A card that renders a single entity record, with optional field list and action buttons. UAR-specific — not part of the uar.a2ui/1 9-component protocol baseline.'
    )
}
