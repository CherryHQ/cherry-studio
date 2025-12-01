/**
 * API Client with SWR integration for catalog management
 *
 * This file provides:
 * - Custom SWR fetchers with Zod validation
 * - Mutations for CRUD operations with optimistic updates
 * - Error handling utilities
 * - Type-safe API interactions
 */

import { useEffect, useState } from 'react'
import type { SWRConfiguration, SWRResponse } from 'swr'
import useSWR from 'swr'
import useSWRMutation from 'swr/mutation'
import type { z } from 'zod'

// Import catalog types and schemas
import type { Model, PaginatedResponse, Provider } from './catalog-types'
import {
  ModelSchema,
  ModelUpdateResponseSchema,
  PaginatedResponseSchema,
  ProviderSchema,
  ProviderUpdateResponseSchema
} from './catalog-types'

// API base configuration
const API_BASE = '/api/catalog'

// Extended error interface for better error handling
export interface ExtendedApiError {
  error: string
  status?: number
  info?: unknown
}

// Generic API fetcher with Zod validation
async function apiFetcher<T extends z.ZodType>(url: string, schema: T, options?: RequestInit): Promise<z.infer<T>> {
  const response = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers
    },
    ...options
  })

  if (!response.ok) {
    const errorData = response.headers.get('content-type')?.includes('application/json')
      ? await response.json()
      : { error: response.statusText }

    const error: ExtendedApiError = {
      error: errorData.error || `HTTP ${response.status}`,
      status: response.status,
      info: errorData
    }

    throw error
  }

  const data = await response.json()
  return schema.parse(data)
}

// API Client class for organized endpoint management
export class ApiClient {
  // Models endpoints
  static models = {
    // Get models with pagination and filtering
    list: (
      params: { page?: number; limit?: number; search?: string; capabilities?: string[]; providers?: string[] } = {}
    ) => {
      const searchParams = new URLSearchParams()

      if (params.page) searchParams.set('page', params.page.toString())
      if (params.limit) searchParams.set('limit', params.limit.toString())
      if (params.search) searchParams.set('search', params.search)
      if (params.capabilities?.length) searchParams.set('capabilities', params.capabilities.join(','))
      if (params.providers?.length) searchParams.set('providers', params.providers.join(','))

      return `${API_BASE}/models?${searchParams.toString()}`
    },

    // Update a model
    update: (id: string, data: Partial<Model>) => ({
      url: `${API_BASE}/models/${id}`,
      method: 'PUT',
      body: data
    }),

    // Delete a model (if implemented)
    delete: (id: string) => ({
      url: `${API_BASE}/models/${id}`,
      method: 'DELETE'
    })
  }

  // Providers endpoints
  static providers = {
    // Get providers with pagination and filtering
    list: (params: { page?: number; limit?: number; search?: string } = {}) => {
      const searchParams = new URLSearchParams()

      if (params.page) searchParams.set('page', params.page.toString())
      if (params.limit) searchParams.set('limit', params.limit.toString())
      if (params.search) searchParams.set('search', params.search)

      return `${API_BASE}/providers?${searchParams.toString()}`
    },

    // Update a provider
    update: (id: string, data: Partial<Provider>) => ({
      url: `${API_BASE}/providers/${id}`,
      method: 'PUT',
      body: data
    }),

    // Delete a provider (if implemented)
    delete: (id: string) => ({
      url: `${API_BASE}/providers/${id}`,
      method: 'DELETE'
    })
  }
}

// SWR Hooks for Models
export function useModels(
  params: {
    page?: number
    limit?: number
    search?: string
    capabilities?: string[]
    providers?: string[]
  } = {},
  config?: SWRConfiguration<PaginatedResponse<Model>, ExtendedApiError>
): SWRResponse<PaginatedResponse<Model>, ExtendedApiError> {
  const url = ApiClient.models.list(params)

  return useSWR<PaginatedResponse<Model>, ExtendedApiError>(
    url,
    (url) => apiFetcher(url, PaginatedResponseSchema(ModelSchema)),
    {
      revalidateOnFocus: true,
      revalidateOnReconnect: true,
      dedupingInterval: 5000,
      errorRetryCount: 3,
      errorRetryInterval: 1000,
      ...config
    }
  )
}

// SWR Hooks for Providers
export function useProviders(
  params: {
    page?: number
    limit?: number
    search?: string
  } = {},
  config?: SWRConfiguration<PaginatedResponse<Provider>, ExtendedApiError>
): SWRResponse<PaginatedResponse<Provider>, ExtendedApiError> {
  const url = ApiClient.providers.list(params)

  return useSWR<PaginatedResponse<Provider>, ExtendedApiError>(
    url,
    (url) => apiFetcher(url, PaginatedResponseSchema(ProviderSchema)),
    {
      revalidateOnFocus: true,
      revalidateOnReconnect: true,
      dedupingInterval: 5000,
      errorRetryCount: 3,
      errorRetryInterval: 1000,
      ...config
    }
  )
}

// Mutation for updating models
export function useUpdateModel() {
  return useSWRMutation(
    '/api/catalog/models',
    async (url: string, { arg }: { arg: { id: string; data: Partial<Model> } }) => {
      const response = await fetch(`${url}/${arg.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(arg.data)
      })

      if (!response.ok) {
        const errorData = await response.json()
        const error: ExtendedApiError = {
          error: errorData.error || 'Failed to update model',
          status: response.status,
          info: errorData
        }
        throw error
      }

      const data = await response.json()
      return ModelUpdateResponseSchema.parse(data)
    }
  )
}

// Mutation for updating providers
export function useUpdateProvider() {
  return useSWRMutation(
    '/api/catalog/providers',
    async (url: string, { arg }: { arg: { id: string; data: Partial<Provider> } }) => {
      const response = await fetch(`${url}/${arg.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(arg.data)
      })

      if (!response.ok) {
        const errorData = await response.json()
        const error: ExtendedApiError = {
          error: errorData.error || 'Failed to update provider',
          status: response.status,
          info: errorData
        }
        throw error
      }

      const data = await response.json()
      return ProviderUpdateResponseSchema.parse(data)
    }
  )
}

// Utility function for global error handling
export function handleApiError(error: unknown): ExtendedApiError {
  if (error && typeof error === 'object' && 'error' in error) {
    return error as ExtendedApiError
  }

  return {
    error: error instanceof Error ? error.message : 'Unknown error occurred'
  }
}

// Utility function to get user-friendly error messages
export function getErrorMessage(error: unknown): string {
  const apiError = handleApiError(error)

  // Map common error codes to user-friendly messages
  switch (apiError.status) {
    case 400:
      return 'Invalid request. Please check your input and try again.'
    case 401:
      return 'Authentication required. Please log in and try again.'
    case 403:
      return 'You do not have permission to perform this action.'
    case 404:
      return 'The requested resource was not found.'
    case 429:
      return 'Too many requests. Please wait a moment and try again.'
    case 500:
      return 'Server error. Please try again later.'
    default:
      return apiError.error || 'An unexpected error occurred.'
  }
}

// Custom hook for debounced search
export function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value)

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value)
    }, delay)

    return () => {
      clearTimeout(handler)
    }
  }, [value, delay])

  return debouncedValue
}

// Export all types for use in components
export type { SWRResponse }

// Re-export SWR types for convenience
export type { SWRConfiguration } from 'swr'

// Legacy API Error class for backward compatibility
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public details?: unknown
  ) {
    super(message)
    this.name = 'ApiError'
  }
}
