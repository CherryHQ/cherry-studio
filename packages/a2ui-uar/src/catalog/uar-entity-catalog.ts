import { Catalog } from '@prometheus-ags/a2ui-core/v0_9'

import { EntityCardApi } from '../entities/entity-card-api'
import {
  EntityApprovalApi,
  EntityChatApi,
  EntityCopilotApi,
  EntityDiffApi,
  EntityStreamApi,
  EntityToolProviderApi,
  UarEntityApproval,
  UarEntityChat,
  UarEntityCopilot,
  UarEntityDiff,
  UarEntityStream,
  UarEntityToolProvider
} from '../entities/entity-extensions'
import { UarEntityCard } from '../entities/EntityCard'
import { createUarComponentImplementation } from '../react/create-component'
import type { UarComponentImplementation } from '../react/types'
import { uarBasicCatalogComponents } from './uar-basic-catalog'

/**
 * Catalog id for the UAR entity-aware extension surface: the 9
 * `uar.a2ui/1` protocol components plus all 7 UAR `Entity*` components.
 *
 * This is a distinct, separately-versioned catalog id from
 * `urn:uar:a2ui:catalog:1` (the certified `uar.a2ui/1` baseline in
 * `docs/protocols/a2ui-profile.md`) because `Entity*` components are a UAR
 * extension, not part of the audited/certified protocol baseline —
 * servers must opt in to `urn:uar:a2ui:catalog:1+entities` explicitly via
 * `createSurface.catalogId` rather than getting extension components for
 * free on the baseline catalog.
 */
export const UAR_A2UI_ENTITY_CATALOG_ID = 'urn:uar:a2ui:catalog:1+entities'

export const uarEntityCatalogComponents: UarComponentImplementation[] = [
  ...uarBasicCatalogComponents,
  createUarComponentImplementation(EntityCardApi, UarEntityCard),
  createUarComponentImplementation(EntityDiffApi, UarEntityDiff),
  createUarComponentImplementation(EntityStreamApi, UarEntityStream),
  createUarComponentImplementation(EntityApprovalApi, UarEntityApproval),
  createUarComponentImplementation(EntityToolProviderApi, UarEntityToolProvider),
  createUarComponentImplementation(EntityChatApi, UarEntityChat),
  createUarComponentImplementation(EntityCopilotApi, UarEntityCopilot)
]

export const uarEntityCatalog = new Catalog<UarComponentImplementation>(
  UAR_A2UI_ENTITY_CATALOG_ID,
  uarEntityCatalogComponents
)
