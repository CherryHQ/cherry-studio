/**
 * Process Pending Issues Script
 * Summarizes pending issues with Claude and sends to Feishu
 */

const crypto = require('crypto')
const https = require('https')

/**
 * Generate Feishu webhook signature
 */
function generateSignature(secret, timestamp) {
  const stringToSign = `${timestamp}\n${secret}`
  const hmac = crypto.createHmac('sha256', stringToSign)
  return hmac.digest('base64')
}

/**
 * Call Claude API to summarize issue
 */
function summarizeWithClaude(issue, apiKey, baseUrl) {
  return new Promise((resolve, reject) => {
    const prompt = `Please analyze this GitHub issue and provide a concise summary in Chinese (中文).

Issue #${issue.number}: ${issue.title}
Author: ${issue.author}
URL: ${issue.url}

Issue Body:
${issue.body || 'No description provided.'}

Please provide:
1. A brief Chinese summary of the issue (2-3 sentences)
2. The main problem or request
3. Any important technical details mentioned

Format your response in clean markdown, suitable for display in a notification card.
Keep it concise but informative.`

    const payload = JSON.stringify({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ]
    })

    const url = new URL(baseUrl || 'https://api.anthropic.com')
    const options = {
      hostname: url.hostname,
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(payload)
      }
    }

    const req = https.request(options, (res) => {
      let data = ''
      res.on('data', (chunk) => {
        data += chunk
      })
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            const response = JSON.parse(data)
            const summary = response.content[0].text
            resolve(summary)
          } catch (error) {
            reject(new Error(`Failed to parse Claude response: ${error.message}`))
          }
        } else {
          reject(new Error(`Claude API error: ${res.statusCode} - ${data}`))
        }
      })
    })

    req.on('error', (error) => {
      reject(error)
    })

    req.write(payload)
    req.end()
  })
}

/**
 * Send message to Feishu webhook
 */
function sendToFeishu(webhookUrl, secret, content) {
  return new Promise((resolve, reject) => {
    const timestamp = Math.floor(Date.now() / 1000)
    const sign = generateSignature(secret, timestamp)

    const payload = JSON.stringify({
      timestamp: timestamp.toString(),
      sign: sign,
      msg_type: 'interactive',
      card: content
    })

    const url = new URL(webhookUrl)
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    }

    const req = https.request(options, (res) => {
      let data = ''
      res.on('data', (chunk) => {
        data += chunk
      })
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve()
        } else {
          reject(new Error(`Feishu API error: ${res.statusCode} - ${data}`))
        }
      })
    })

    req.on('error', (error) => {
      reject(error)
    })

    req.write(payload)
    req.end()
  })
}

/**
 * Create Feishu card message from issue data
 */
function createIssueCard(issueData) {
  const { url, number, title, summary, author, labels } = issueData

  return {
    elements: [
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: `**🐛 New GitHub Issue #${number}**`
        }
      },
      {
        tag: 'hr'
      },
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: `**📝 Title:** ${title}`
        }
      },
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: `**👤 Author:** ${author}`
        }
      },
      ...(labels && labels.length > 0
        ? [
            {
              tag: 'div',
              text: {
                tag: 'lark_md',
                content: `**🏷️ Labels:** ${labels.join(', ')}`
              }
            }
          ]
        : []),
      {
        tag: 'hr'
      },
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: `**📋 Summary:**\n${summary}`
        }
      },
      {
        tag: 'hr'
      },
      {
        tag: 'action',
        actions: [
          {
            tag: 'button',
            text: {
              tag: 'plain_text',
              content: '🔗 View Issue'
            },
            type: 'primary',
            url: url
          }
        ]
      }
    ],
    header: {
      template: 'blue',
      title: {
        tag: 'plain_text',
        content: '🆕 Cherry Studio - New Issue'
      }
    }
  }
}

/**
 * Main function
 */
async function main() {
  try {
    // Get environment variables
    const webhookUrl = process.env.FEISHU_WEBHOOK_URL
    const secret = process.env.FEISHU_WEBHOOK_SECRET
    const apiKey = process.env.ANTHROPIC_API_KEY
    const baseUrl = process.env.ANTHROPIC_BASE_URL

    // Validate required environment variables
    if (!webhookUrl || !secret || !apiKey) {
      throw new Error('Required environment variables are missing')
    }

    // Get issues from command line argument
    const issuesJson = process.argv[2]
    if (!issuesJson) {
      console.log('No pending issues to process')
      return
    }

    const issues = JSON.parse(issuesJson)

    if (issues.length === 0) {
      console.log('No pending issues to process')
      return
    }

    console.log(`📋 Processing ${issues.length} pending issue(s)...`)

    // Process each issue
    for (const issue of issues) {
      try {
        console.log(`\n🔄 Processing issue #${issue.number}: ${issue.title}`)

        // Summarize with Claude
        console.log('  📝 Generating AI summary...')
        const summary = await summarizeWithClaude(issue, apiKey, baseUrl)

        // Create card
        const card = createIssueCard({
          url: issue.url,
          number: issue.number,
          title: issue.title,
          summary: summary,
          author: issue.author,
          labels: issue.labels
        })

        // Send to Feishu
        console.log('  📤 Sending to Feishu...')
        await sendToFeishu(webhookUrl, secret, card)

        console.log(`  ✅ Successfully processed issue #${issue.number}`)

        // Wait a bit between issues to avoid rate limiting
        if (issues.length > 1) {
          await new Promise((resolve) => setTimeout(resolve, 2000))
        }
      } catch (error) {
        console.error(`  ❌ Failed to process issue #${issue.number}: ${error.message}`)
        // Continue with next issue even if one fails
      }
    }

    console.log('\n✅ All pending issues processed!')
  } catch (error) {
    console.error('❌ Error:', error.message)
    process.exit(1)
  }
}

// Run main function
main()
