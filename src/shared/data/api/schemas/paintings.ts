/**
 * TRANSITION SHIM — the `/paintings` endpoints are now `/creations` with
 * `kind: 'image'`. These DTO aliases keep the legacy paintings page compiling;
 * its `usePaintings` hook injects `kind: 'image'` when calling `/creations`.
 * Removed when the page is rewritten as the unified Creation page (Phase 5).
 */

import type { CreateCreationDto, CreationListResponse, ListCreationsQueryParams, UpdateCreationDto } from './creations'

/** Create DTO minus `kind` — the legacy page omits it; `usePaintings` adds `kind: 'image'`. */
export type CreatePaintingDto = Omit<CreateCreationDto, 'kind'>
export type UpdatePaintingDto = UpdateCreationDto
export type ListPaintingsQueryParams = Omit<ListCreationsQueryParams, 'kind'>
export type PaintingListResponse = CreationListResponse
