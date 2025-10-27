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

import { loggerService } from '@logger'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'

const logger = loggerService.withContext('DiDiMCPServer')

export class DiDiMcpServer {
  private _server: Server
  private readonly baseUrl = 'http://mcp.didichuxing.com/mcp-servers'
  private apiKey: string

  constructor(apiKey?: string) {
    this._server = new Server(
      {
        name: 'didi-mcp-server',
        version: '0.1.0'
      },
      {
        capabilities: {
          tools: {}
        }
      }
    )

    // Get API key from parameter or environment variables
    this.apiKey = apiKey || process.env.DIDI_API_KEY || ''
    if (!this.apiKey) {
      logger.warn('DIDI_API_KEY environment variable is not set')
    }

    this.setupRequestHandlers()
  }

  get server(): Server {
    return this._server
  }

  private setupRequestHandlers() {
    // List available tools
    this._server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: 'maps_textsearch',
            description: 'Search for POI locations based on keywords and city',
            inputSchema: {
              type: 'object',
              properties: {
                city: {
                  type: 'string',
                  description: 'Query city'
                },
                keywords: {
                  type: 'string',
                  description: 'Search keywords'
                },
                location: {
                  type: 'string',
                  description: 'Location coordinates, format: longitude,latitude'
                }
              },
              required: ['keywords', 'city']
            }
          },
          {
            name: 'taxi_cancel_order',
            description: 'Cancel a taxi order',
            inputSchema: {
              type: 'object',
              properties: {
                order_id: {
                  type: 'string',
                  description: 'Order ID from order creation or query results'
                },
                reason: {
                  type: 'string',
                  description:
                    'Cancellation reason (optional). Examples: no longer needed, waiting too long, urgent matter'
                }
              },
              required: ['order_id']
            }
          },
          {
            name: 'taxi_create_order',
            description: 'Create taxi order directly via API without opening any app interface',
            inputSchema: {
              type: 'object',
              properties: {
                caller_car_phone: {
                  type: 'string',
                  description: 'Caller phone number (optional)'
                },
                estimate_trace_id: {
                  type: 'string',
                  description: 'Estimation trace ID from estimation results'
                },
                product_category: {
                  type: 'string',
                  description: 'Vehicle category ID from estimation results, comma-separated for multiple types'
                }
              },
              required: ['product_category', 'estimate_trace_id']
            }
          },
          {
            name: 'taxi_estimate',
            description: 'Get available ride-hailing vehicle types and fare estimates',
            inputSchema: {
              type: 'object',
              properties: {
                from_lat: {
                  type: 'string',
                  description: 'Departure latitude, must be from map tools'
                },
                from_lng: {
                  type: 'string',
                  description: 'Departure longitude, must be from map tools'
                },
                from_name: {
                  type: 'string',
                  description: 'Departure location name'
                },
                to_lat: {
                  type: 'string',
                  description: 'Destination latitude, must be from map tools'
                },
                to_lng: {
                  type: 'string',
                  description: 'Destination longitude, must be from map tools'
                },
                to_name: {
                  type: 'string',
                  description: 'Destination name'
                }
              },
              required: ['from_lng', 'from_lat', 'from_name', 'to_lng', 'to_lat', 'to_name']
            }
          },
          {
            name: 'taxi_generate_ride_app_link',
            description: 'Generate deep links to open ride-hailing apps based on origin, destination and vehicle type',
            inputSchema: {
              type: 'object',
              properties: {
                from_lat: {
                  type: 'string',
                  description: 'Departure latitude, must be from map tools'
                },
                from_lng: {
                  type: 'string',
                  description: 'Departure longitude, must be from map tools'
                },
                product_category: {
                  type: 'string',
                  description: 'Vehicle category IDs from estimation results, comma-separated for multiple types'
                },
                to_lat: {
                  type: 'string',
                  description: 'Destination latitude, must be from map tools'
                },
                to_lng: {
                  type: 'string',
                  description: 'Destination longitude, must be from map tools'
                }
              },
              required: ['from_lng', 'from_lat', 'to_lng', 'to_lat']
            }
          },
          {
            name: 'taxi_get_driver_location',
            description: 'Get real-time driver location for a taxi order',
            inputSchema: {
              type: 'object',
              properties: {
                order_id: {
                  type: 'string',
                  description: 'Taxi order ID'
                }
              },
              required: ['order_id']
            }
          },
          {
            name: 'taxi_query_order',
            description: 'Query taxi order status and information such as driver contact, license plate, ETA',
            inputSchema: {
              type: 'object',
              properties: {
                order_id: {
                  type: 'string',
                  description: 'Order ID from order creation results, if available; otherwise queries incomplete orders'
                }
              }
            }
          }
        ]
      }
    })

    // Handle tool calls
    this._server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params

      try {
        switch (name) {
          case 'maps_textsearch':
            return await this.handleMapsTextSearch(args)
          case 'taxi_cancel_order':
            return await this.handleTaxiCancelOrder(args)
          case 'taxi_create_order':
            return await this.handleTaxiCreateOrder(args)
          case 'taxi_estimate':
            return await this.handleTaxiEstimate(args)
          case 'taxi_generate_ride_app_link':
            return await this.handleTaxiGenerateRideAppLink(args)
          case 'taxi_get_driver_location':
            return await this.handleTaxiGetDriverLocation(args)
          case 'taxi_query_order':
            return await this.handleTaxiQueryOrder(args)
          default:
            throw new Error(`Unknown tool: ${name}`)
        }
      } catch (error) {
        logger.error(`Error calling tool ${name}:`, error as Error)
        throw error
      }
    })
  }

  private async handleMapsTextSearch(args: any) {
    const { city, keywords, location } = args

    const params = {
      name: 'maps_textsearch',
      arguments: {
        keywords,
        city,
        ...(location && { location })
      }
    }

    try {
      const response = await this.makeRequest('tools/call', params)
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(response, null, 2)
          }
        ]
      }
    } catch (error) {
      logger.error('Maps text search error:', error as Error)
      throw error
    }
  }

  private async handleTaxiCancelOrder(args: any) {
    const { order_id, reason } = args

    const params = {
      name: 'taxi_cancel_order',
      arguments: {
        order_id,
        ...(reason && { reason })
      }
    }

    try {
      const response = await this.makeRequest('tools/call', params)
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(response, null, 2)
          }
        ]
      }
    } catch (error) {
      logger.error('Taxi cancel order error:', error as Error)
      throw error
    }
  }

  private async handleTaxiCreateOrder(args: any) {
    const { caller_car_phone, estimate_trace_id, product_category } = args

    const params = {
      name: 'taxi_create_order',
      arguments: {
        product_category,
        estimate_trace_id,
        ...(caller_car_phone && { caller_car_phone })
      }
    }

    try {
      const response = await this.makeRequest('tools/call', params)
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(response, null, 2)
          }
        ]
      }
    } catch (error) {
      logger.error('Taxi create order error:', error as Error)
      throw error
    }
  }

  private async handleTaxiEstimate(args: any) {
    const { from_lng, from_lat, from_name, to_lng, to_lat, to_name } = args

    const params = {
      name: 'taxi_estimate',
      arguments: {
        from_lng,
        from_lat,
        from_name,
        to_lng,
        to_lat,
        to_name
      }
    }

    try {
      const response = await this.makeRequest('tools/call', params)
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(response, null, 2)
          }
        ]
      }
    } catch (error) {
      logger.error('Taxi estimate error:', error as Error)
      throw error
    }
  }

  private async handleTaxiGenerateRideAppLink(args: any) {
    const { from_lng, from_lat, to_lng, to_lat, product_category } = args

    const params = {
      name: 'taxi_generate_ride_app_link',
      arguments: {
        from_lng,
        from_lat,
        to_lng,
        to_lat,
        ...(product_category && { product_category })
      }
    }

    try {
      const response = await this.makeRequest('tools/call', params)
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(response, null, 2)
          }
        ]
      }
    } catch (error) {
      logger.error('Taxi generate ride app link error:', error as Error)
      throw error
    }
  }

  private async handleTaxiGetDriverLocation(args: any) {
    const { order_id } = args

    const params = {
      name: 'taxi_get_driver_location',
      arguments: {
        order_id
      }
    }

    try {
      const response = await this.makeRequest('tools/call', params)
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(response, null, 2)
          }
        ]
      }
    } catch (error) {
      logger.error('Taxi get driver location error:', error as Error)
      throw error
    }
  }

  private async handleTaxiQueryOrder(args: any) {
    const { order_id } = args

    const params = {
      name: 'taxi_query_order',
      arguments: {
        ...(order_id && { order_id })
      }
    }

    try {
      const response = await this.makeRequest('tools/call', params)
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(response, null, 2)
          }
        ]
      }
    } catch (error) {
      logger.error('Taxi query order error:', error as Error)
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
