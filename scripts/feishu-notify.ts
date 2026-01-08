#!/usr/bin/env npx tsx
/**
 * @fileoverview Feishu (Lark) Webhook Notification CLI Tool
 * @description Sends notifications to Feishu with signature verification.
 * Supports subcommands for different notification types.
 * @module feishu-notify
 * @example
 * // Send GitHub issue notification
 * pnpm tsx feishu-notify.ts issue -u "https://..." -n "123" -t "Title" -m "Summary"
 *
 * // Using environment variables for credentials
 * FEISHU_WEBHOOK_URL="..." FEISHU_WEBHOOK_SECRET="..." pnpm tsx feishu-notify.ts issue ...
 */

import { Command } from 'commander'
import crypto from 'crypto'
import dotenv from 'dotenv'
import https from 'https'
import * as z from 'zod'

// Load environment variables from .env file
dotenv.config()

/** CLI tool version */
const VERSION = '1.0.0'

/** GitHub issue data structure */
interface IssueData {
  /** GitHub issue URL */
  issueUrl: string
  /** Issue number */
  issueNumber: string
  /** Issue title */
  issueTitle: string
  /** Issue summary/description */
  issueSummary: string
  /** Issue author username */
  issueAuthor: string
  /** Issue labels */
  labels: string[]
}

/** Feishu card text element */
interface FeishuTextElement {
  tag: 'div'
  text: {
    tag: 'lark_md'
    content: string
  }
}

/** Feishu card horizontal rule element */
interface FeishuHrElement {
  tag: 'hr'
}

/** Feishu card action button */
interface FeishuActionElement {
  tag: 'action'
  actions: Array<{
    tag: 'button'
    text: {
      tag: 'plain_text'
      content: string
    }
    type: 'primary' | 'default'
    url: string
  }>
}

/** Feishu card element union type */
type FeishuCardElement = FeishuTextElement | FeishuHrElement | FeishuActionElement

/** Zod schema for Feishu header color template */
const FeishuHeaderTemplateSchema = z.enum([
  'blue',
  'wathet',
  'turquoise',
  'green',
  'yellow',
  'orange',
  'red',
  'carmine',
  'violet',
  'purple',
  'indigo',
  'grey',
  'default'
])

/** Feishu card header color template (inferred from schema) */
type FeishuHeaderTemplate = z.infer<typeof FeishuHeaderTemplateSchema>

/** Feishu interactive card structure */
interface FeishuCard {
  elements: FeishuCardElement[]
  header: {
    template: FeishuHeaderTemplate
    title: {
      tag: 'plain_text'
      content: string
    }
  }
}

/** Feishu webhook request payload */
interface FeishuPayload {
  timestamp: string
  sign: string
  msg_type: 'interactive'
  card: FeishuCard
}

/** Issue subcommand options */
interface IssueOptions {
  url: string
  number: string
  title: string
  summary: string
  author?: string
  labels?: string
}

/** Send subcommand options */
interface SendOptions {
  title: string
  description: string
  color?: string
}

/**
 * Generate Feishu webhook signature using HMAC-SHA256
 * @param secret - Feishu webhook secret
 * @param timestamp - Unix timestamp in seconds
 * @returns Base64 encoded signature
 */
function generateSignature(secret: string, timestamp: number): string {
  const stringToSign = `${timestamp}\n${secret}`
  const hmac = crypto.createHmac('sha256', stringToSign)
  return hmac.digest('base64')
}

/**
 * Send message to Feishu webhook
 * @param webhookUrl - Feishu webhook URL
 * @param secret - Feishu webhook secret
 * @param content - Feishu card message content
 * @returns Resolves when message is sent successfully
 * @throws When Feishu API returns non-2xx status code or network error occurs
 */
function sendToFeishu(webhookUrl: string, secret: string, content: FeishuCard): Promise<void> {
  return new Promise((resolve, reject) => {
    const timestamp = Math.floor(Date.now() / 1000)
    const sign = generateSignature(secret, timestamp)

    const payload: FeishuPayload = {
      timestamp: timestamp.toString(),
      sign,
      msg_type: 'interactive',
      card: content
    }

    const payloadStr = JSON.stringify(payload)
    const url = new URL(webhookUrl)

    const options: https.RequestOptions = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payloadStr)
      }
    }

    const req = https.request(options, (res) => {
      let data = ''
      res.on('data', (chunk: Buffer) => {
        data += chunk.toString()
      })
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          console.log('Successfully sent to Feishu:', data)
          resolve()
        } else {
          reject(new Error(`Feishu API error: ${res.statusCode} - ${data}`))
        }
      })
    })

    req.on('error', (error: Error) => {
      reject(error)
    })

    req.write(payloadStr)
    req.end()
  })
}

/**
 * Create Feishu card message from issue data
 * @param issueData - GitHub issue data
 * @returns Feishu card content
 */
function createIssueCard(issueData: IssueData): FeishuCard {
  const { issueUrl, issueNumber, issueTitle, issueSummary, issueAuthor, labels } = issueData

  const elements: FeishuCardElement[] = [
    {
      tag: 'div',
      text: {
        tag: 'lark_md',
        content: `**Author:** ${issueAuthor}`
      }
    }
  ]

  if (labels.length > 0) {
    elements.push({
      tag: 'div',
      text: {
        tag: 'lark_md',
        content: `**Labels:** ${labels.join(', ')}`
      }
    })
  }

  elements.push(
    { tag: 'hr' },
    {
      tag: 'div',
      text: {
        tag: 'lark_md',
        content: `**Summary:**\n${issueSummary}`
      }
    },
    { tag: 'hr' },
    {
      tag: 'action',
      actions: [
        {
          tag: 'button',
          text: {
            tag: 'plain_text',
            content: 'View Issue'
          },
          type: 'primary',
          url: issueUrl
        }
      ]
    }
  )

  return {
    elements,
    header: {
      template: 'blue',
      title: {
        tag: 'plain_text',
        content: `#${issueNumber} - ${issueTitle}`
      }
    }
  }
}

/**
 * Create a simple Feishu card message
 * @param title - Card title
 * @param description - Card description content
 * @param color - Header color template (default: 'turquoise')
 * @returns Feishu card content
 */
function createSimpleCard(title: string, description: string, color: FeishuHeaderTemplate = 'turquoise'): FeishuCard {
  return {
    elements: [
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: description
        }
      }
    ],
    header: {
      template: color,
      title: {
        tag: 'plain_text',
        content: title
      }
    }
  }
}

/**
 * Get Feishu credentials from environment variables
 */
function getCredentials(): { webhookUrl: string; secret: string } {
  const webhookUrl = process.env.FEISHU_WEBHOOK_URL
  const secret = process.env.FEISHU_WEBHOOK_SECRET

  if (!webhookUrl) {
    console.error('Error: FEISHU_WEBHOOK_URL environment variable is required')
    process.exit(1)
  }
  if (!secret) {
    console.error('Error: FEISHU_WEBHOOK_SECRET environment variable is required')
    process.exit(1)
  }

  return { webhookUrl, secret }
}

/**
 * Handle send subcommand
 */
async function handleSendCommand(options: SendOptions): Promise<void> {
  const { webhookUrl, secret } = getCredentials()

  const { title, description, color = 'turquoise' } = options

  // Validate color parameter
  const colorValidation = FeishuHeaderTemplateSchema.safeParse(color)
  if (!colorValidation.success) {
    console.error(`Error: Invalid color "${color}". Valid colors: ${FeishuHeaderTemplateSchema.options.join(', ')}`)
    process.exit(1)
  }

  const card = createSimpleCard(title, description, colorValidation.data)

  console.log('Sending notification to Feishu...')
  console.log(`Title: ${title}`)

  await sendToFeishu(webhookUrl, secret, card)

  console.log('Notification sent successfully!')
}

/**
 * Handle issue subcommand
 */
async function handleIssueCommand(options: IssueOptions): Promise<void> {
  const { webhookUrl, secret } = getCredentials()

  const { url, number, title, summary, author = 'Unknown', labels: labelsStr = '' } = options

  if (!url || !number || !title || !summary) {
    console.error('Error: --url, --number, --title, and --summary are required')
    process.exit(1)
  }

  const labels = labelsStr
    ? labelsStr
        .split(',')
        .map((l) => l.trim())
        .filter(Boolean)
    : []

  const issueData: IssueData = {
    issueUrl: url,
    issueNumber: number,
    issueTitle: title,
    issueSummary: summary,
    issueAuthor: author,
    labels
  }

  const card = createIssueCard(issueData)

  console.log('Sending notification to Feishu...')
  console.log(`Issue #${number}: ${title}`)

  await sendToFeishu(webhookUrl, secret, card)

  console.log('Notification sent successfully!')
}

// Configure CLI
const program = new Command()

program.name('feishu-notify').description('Send notifications to Feishu webhook').version(VERSION)

// Send subcommand (generic)
program
  .command('send')
  .description('Send a simple notification to Feishu')
  .requiredOption('-t, --title <title>', 'Card title')
  .requiredOption('-d, --description <description>', 'Card description (supports markdown)')
  .option(
    '-c, --color <color>',
    `Header color template (default: turquoise). Options: ${FeishuHeaderTemplateSchema.options.join(', ')}`,
    'turquoise'
  )
  .action(async (options: SendOptions) => {
    try {
      await handleSendCommand(options)
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : error)
      process.exit(1)
    }
  })

// Issue subcommand
program
  .command('issue')
  .description('Send GitHub issue notification to Feishu')
  .requiredOption('-u, --url <url>', 'GitHub issue URL')
  .requiredOption('-n, --number <number>', 'Issue number')
  .requiredOption('-t, --title <title>', 'Issue title')
  .requiredOption('-m, --summary <summary>', 'Issue summary')
  .option('-a, --author <author>', 'Issue author', 'Unknown')
  .option('-l, --labels <labels>', 'Issue labels, comma-separated')
  .action(async (options: IssueOptions) => {
    try {
      await handleIssueCommand(options)
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : error)
      process.exit(1)
    }
  })

program.parse()
