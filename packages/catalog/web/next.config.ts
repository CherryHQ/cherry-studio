import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Configure static file serving from external directory
  async rewrites() {
    return [
      // Proxy API requests to the catalog API
      {
        source: '/api/catalog/:path*',
        destination: 'http://localhost:3001/api/catalog/:path*'
      }
    ]
  },
  // Add custom headers for static files
  async headers() {
    return [
      {
        source: '/data/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=3600, must-revalidate'
          },
          {
            key: 'Access-Control-Allow-Origin',
            value: '*'
          }
        ]
      }
    ]
  },
  // Configure serving static files from outside public directory
  outputFileTracingExcludes: {
    '*': ['./**/__tests__/**/*']
  },
  // Basic Turbopack configuration to silence warning
  turbopack: {}
}

export default nextConfig
