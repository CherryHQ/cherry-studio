#!/usr/bin/env node

/**
 * Port conflict checker for multi-project development
 *
 * @description Checks if port 5173 is in use and provides helpful information
 * for developers running multiple projects simultaneously
 *
 * @author AutoConfigAgent
 * @since 2025-01-27
 */

const { exec } = require('child_process')
const path = require('path')

const PREFERRED_PORT = 5173
const PROJECT_NAME = path.basename(process.cwd())

console.log(`🔍 Checking port ${PREFERRED_PORT} for project: ${PROJECT_NAME}`)

// Check what's using the port
exec(`lsof -i :${PREFERRED_PORT}`, (error, stdout) => {
  if (error) {
    // Port is free
    console.log(`✅ Port ${PREFERRED_PORT} is available`)
    console.log(`🚀 Starting development server...`)
    return
  }

  if (stdout) {
    const lines = stdout.trim().split('\n')
    const processInfo = lines.slice(1) // Skip header

    console.log(`⚠️  Port ${PREFERRED_PORT} is currently in use:`)

    processInfo.forEach((line) => {
      const parts = line.split(/\s+/)
      const command = parts[0]
      const pid = parts[1]

      // Try to get more details about the process
      exec(`ps -p ${pid} -o args=`, (psError, psStdout) => {
        if (!psError && psStdout) {
          const fullCommand = psStdout.trim()

          // Check if it's another project's Vite server
          if (fullCommand.includes('vite') || fullCommand.includes('dev')) {
            console.log(`   📂 ${command} (PID: ${pid}) - Likely another project's dev server`)
            console.log(`      Command: ${fullCommand}`)

            // Extract project path if possible
            const pathMatch = fullCommand.match(/([^/\s]+\/[^/\s]+)\//)
            if (pathMatch) {
              console.log(`      Project: ${pathMatch[1]}`)
            }
          } else {
            console.log(`   🔧 ${command} (PID: ${pid}) - ${fullCommand}`)
          }
        }
      })
    })

    console.log(`\n💡 Solutions:`)
    console.log(`   1. Vite will automatically use the next available port (5174, 5175, etc.)`)
    console.log(`   2. Stop the other process: kill ${processInfo[0].split(/\s+/)[1]}`)
    console.log(`   3. Use a different port: VITE_PORT=5174 npm run dev`)
    console.log(`\n🚀 Starting development server (will auto-increment port if needed)...`)
  }
})

// Also check for common development ports
const commonPorts = [3000, 3001, 5174, 5175, 8080, 8081]
console.log(`\n📊 Checking other common development ports...`)

commonPorts.forEach((port) => {
  exec(`lsof -i :${port}`, (error, stdout) => {
    if (!error && stdout) {
      const processLine = stdout.split('\n')[1]
      if (processLine) {
        const command = processLine.split(/\s+/)[0]
        console.log(`   Port ${port}: ${command} (in use)`)
      }
    }
  })
})

setTimeout(() => {
  console.log(`\n✨ Port check complete. Starting electron-vite...`)
}, 1000)
