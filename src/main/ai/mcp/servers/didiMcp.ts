/**
 * DiDi MCP Server Implementation
 *
 * Based on official DiDi MCP API capabilities.
 * API Documentation: https://mcp.didichuxing.com/api?tap=api
 *
 * Provides ride-hailing services including map search, price estimation,
 * order management, and driver tracking.
 *
 * Note: Only available in Mainland China.
 */

import { type CallToolResult, McpServer } from '@modelcontextprotocol/server'
import * as z from 'zod'

import { loggerService } from '@logger'

const logger = loggerService.withContext('DiDiMcpServer')

const departureLat = z.string().describe('Departure latitude, must be from map tools')
const departureLng = z.string().describe('Departure longitude, must be from map tools')
const destinationLat = z.string().describe('Destination latitude, must be from map tools')
const destinationLng = z.string().describe('Destination longitude, must be from map tools')

export class DiDiMcpServer {
  private _server: McpServer
  private readonly baseUrl = 'https://mcp.didichuxing.com/mcp-servers'
  private apiKey: string

  constructor(apiKey?: string) {
    this._server = new McpServer({
      name: 'didi-mcp-server',
      version: '0.1.0'
    })

    // Get API key from parameter or environment variables
    this.apiKey = apiKey || process.env.DIDI_API_KEY || ''
    if (!this.apiKey) {
      logger.warn('DIDI_API_KEY environment variable is not set')
    }

    this.registerTools()
  }

  get server(): McpServer {
    return this._server
  }

  private registerTools() {
    this._server.registerTool(
      'maps_textsearch',
      {
        description: 'Search for POI locations based on keywords and city',
        inputSchema: z.object({
          city: z.string().describe('Query city'),
          keywords: z.string().describe('Search keywords'),
          location: z.string().optional().describe('Location coordinates, format: longitude,latitude')
        })
      },
      ({ city, keywords, location }) =>
        this.callRemoteTool('maps_textsearch', { keywords, city, ...(location && { location }) })
    )

    this._server.registerTool(
      'taxi_cancel_order',
      {
        description: 'Cancel a taxi order',
        inputSchema: z.object({
          order_id: z.string().describe('Order ID from order creation or query results'),
          reason: z
            .string()
            .optional()
            .describe('Cancellation reason (optional). Examples: no longer needed, waiting too long, urgent matter')
        })
      },
      ({ order_id, reason }) => this.callRemoteTool('taxi_cancel_order', { order_id, ...(reason && { reason }) })
    )

    this._server.registerTool(
      'taxi_create_order',
      {
        description: 'Create taxi order directly via API without opening any app interface',
        inputSchema: z.object({
          caller_car_phone: z.string().optional().describe('Caller phone number (optional)'),
          estimate_trace_id: z.string().describe('Estimation trace ID from estimation results'),
          product_category: z
            .string()
            .describe('Vehicle category ID from estimation results, comma-separated for multiple types')
        })
      },
      ({ caller_car_phone, estimate_trace_id, product_category }) =>
        this.callRemoteTool('taxi_create_order', {
          product_category,
          estimate_trace_id,
          ...(caller_car_phone && { caller_car_phone })
        })
    )

    this._server.registerTool(
      'taxi_estimate',
      {
        description: 'Get available ride-hailing vehicle types and fare estimates',
        inputSchema: z.object({
          from_lat: departureLat,
          from_lng: departureLng,
          from_name: z.string().describe('Departure location name'),
          to_lat: destinationLat,
          to_lng: destinationLng,
          to_name: z.string().describe('Destination name')
        })
      },
      (args) => this.callRemoteTool('taxi_estimate', args)
    )

    this._server.registerTool(
      'taxi_generate_ride_app_link',
      {
        description: 'Generate deep links to open ride-hailing apps based on origin, destination and vehicle type',
        inputSchema: z.object({
          from_lat: departureLat,
          from_lng: departureLng,
          product_category: z
            .string()
            .optional()
            .describe('Vehicle category IDs from estimation results, comma-separated for multiple types'),
          to_lat: destinationLat,
          to_lng: destinationLng
        })
      },
      ({ from_lng, from_lat, to_lng, to_lat, product_category }) =>
        this.callRemoteTool('taxi_generate_ride_app_link', {
          from_lng,
          from_lat,
          to_lng,
          to_lat,
          ...(product_category && { product_category })
        })
    )

    this._server.registerTool(
      'taxi_get_driver_location',
      {
        description: 'Get real-time driver location for a taxi order',
        inputSchema: z.object({ order_id: z.string().describe('Taxi order ID') })
      },
      (args) => this.callRemoteTool('taxi_get_driver_location', args)
    )

    this._server.registerTool(
      'taxi_query_order',
      {
        description: 'Query taxi order status and information such as driver contact, license plate, ETA',
        inputSchema: z.object({
          order_id: z
            .string()
            .optional()
            .describe('Order ID from order creation results, if available; otherwise queries incomplete orders')
        })
      },
      ({ order_id }) => this.callRemoteTool('taxi_query_order', { ...(order_id && { order_id }) })
    )
  }

  private async callRemoteTool(name: string, args: Record<string, string>): Promise<CallToolResult> {
    try {
      const response = await this.makeRequest('tools/call', { name, arguments: args })
      return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] }
    } catch (error) {
      logger.error(`Error calling tool ${name}:`, error as Error)
      throw error
    }
  }

  private async makeRequest(method: string, params: any): Promise<any> {
    const requestData = {
      jsonrpc: '2.0',
      method: method,
      id: Date.now(),
      ...(Object.keys(params).length > 0 && { params })
    }

    // API key is passed as URL parameter
    const url = `${this.baseUrl}?key=${this.apiKey}`

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestData)
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`HTTP ${response.status}: ${errorText}`)
    }

    const data = await response.json()

    if (data.error) {
      throw new Error(`API Error: ${JSON.stringify(data.error)}`)
    }

    return data.result
  }
}

export default DiDiMcpServer
