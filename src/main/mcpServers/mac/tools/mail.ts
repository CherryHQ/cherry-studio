import { loggerService } from '@logger'

import {
  MAX_INPUT_LENGTHS,
  MAX_RESULTS,
  runAppleScript,
  sanitizeAppleScriptString,
  TIMEOUT_MS,
  validateInput
} from '../applescript'
import type { EmailMessage, MailAccount, Mailbox, ToolResponse } from '../types'
import { MailArgsSchema } from '../types'
import { errorResponse, handleAppleScriptError, successResponse, truncateContent } from './utils'

const logger = loggerService.withContext('MacMCP')

// Tool definition for MCP
export const mailToolDefinition = {
  name: 'mail',
  description:
    'Interact with Apple Mail app. Operations: unread (get unread emails), search (find emails), send (compose email), mailboxes (list mailboxes), accounts (list accounts), latest (recent emails). Requires macOS Automation permission.',
  inputSchema: {
    type: 'object',
    properties: {
      operation: {
        type: 'string',
        enum: ['unread', 'search', 'send', 'mailboxes', 'accounts', 'latest'],
        description: 'Operation to perform'
      },
      query: {
        type: 'string',
        description: 'Search query (for search operation)'
      },
      limit: {
        type: 'number',
        description: 'Maximum number of results to return'
      },
      to: {
        type: 'string',
        description: 'Recipient email address (for send operation)'
      },
      subject: {
        type: 'string',
        description: 'Email subject (for send operation)'
      },
      body: {
        type: 'string',
        description: 'Email body content (for send operation)'
      },
      account: {
        type: 'string',
        description: 'Account name filter (for unread operation)'
      },
      mailbox: {
        type: 'string',
        description: 'Mailbox name filter (for unread operation)'
      }
    },
    required: ['operation']
  }
}

// Handler function
export async function handleMail(args: unknown): Promise<ToolResponse> {
  const parsed = MailArgsSchema.safeParse(args)
  if (!parsed.success) {
    return errorResponse(`Invalid arguments: ${parsed.error.message}`)
  }

  const { operation, ...rest } = parsed.data
  logger.info('Mail tool called', { operation })

  try {
    switch (operation) {
      case 'unread':
        return await getUnreadEmails(rest.account, rest.mailbox, rest.limit)
      case 'search':
        return await searchEmails(rest.query, rest.limit)
      case 'send':
        return await sendEmail(rest.to, rest.subject, rest.body)
      case 'mailboxes':
        return await listMailboxes(rest.account)
      case 'accounts':
        return await listAccounts()
      case 'latest':
        return await getLatestEmails(rest.limit)
      default:
        return errorResponse(`Unknown operation: ${operation}`)
    }
  } catch (error) {
    return handleAppleScriptError(error, 'Mail', operation)
  }
}

// Get unread emails
async function getUnreadEmails(account?: string, mailbox?: string, limit?: number): Promise<ToolResponse> {
  const maxEmails = limit || MAX_RESULTS.emails
  const hasAccountFilter = account && account.trim() !== ''
  const hasMailboxFilter = mailbox && mailbox.trim() !== ''

  let sanitizedAccount = ''
  let sanitizedMailbox = ''

  if (hasAccountFilter) {
    validateInput(account, MAX_INPUT_LENGTHS.searchQuery, 'Account name')
    sanitizedAccount = sanitizeAppleScriptString(account)
  }

  if (hasMailboxFilter) {
    validateInput(mailbox, MAX_INPUT_LENGTHS.searchQuery, 'Mailbox name')
    sanitizedMailbox = sanitizeAppleScriptString(mailbox)
  }

  const script = `
tell application "Mail"
  set unreadMsgs to {}
  set msgCount to 0

  repeat with acct in accounts
    set acctName to name of acct
    ${hasAccountFilter ? `if acctName is not "${sanitizedAccount}" then next repeat` : ''}

    repeat with mbox in mailboxes of acct
      set mboxName to name of mbox
      ${hasMailboxFilter ? `if mboxName is not "${sanitizedMailbox}" then next repeat` : ''}

      try
        repeat with msg in (messages of mbox whose read status is false)
          if msgCount >= ${maxEmails} then exit repeat

          set msgSubject to subject of msg
          set msgSender to sender of msg
          set msgDate to date sent of msg as string
          set msgContent to content of msg

          -- Truncate content for preview
          if (length of msgContent) > ${MAX_RESULTS.contentPreview} then
            set msgContent to (characters 1 thru ${MAX_RESULTS.contentPreview} of msgContent) as string
            set msgContent to msgContent & "..."
          end if

          set msgInfo to {msgSubject:msgSubject, msgSender:msgSender, msgDate:msgDate, msgMailbox:mboxName, msgAccount:acctName, msgContent:msgContent}
          set end of unreadMsgs to msgInfo
          set msgCount to msgCount + 1
        end repeat
      on error
        -- Skip problematic mailboxes
      end try

      if msgCount >= ${maxEmails} then exit repeat
    end repeat

    if msgCount >= ${maxEmails} then exit repeat
  end repeat

  return unreadMsgs
end tell`

  logger.debug('Executing get unread emails', { hasAccountFilter, hasMailboxFilter })
  const result = await runAppleScript(script, TIMEOUT_MS.list)

  const emails = parseEmailsResult(result)
  logger.info('Get unread emails completed', { count: emails.length })

  return successResponse({
    emails: emails.map((email) => ({
      subject: email.subject,
      sender: email.sender,
      dateSent: email.dateSent,
      mailbox: email.mailbox,
      content: truncateContent(email.content, MAX_RESULTS.contentPreview)
    })),
    count: emails.length
  })
}

// Search emails by query
async function searchEmails(query?: string, limit?: number): Promise<ToolResponse> {
  if (!query || query.trim() === '') {
    return errorResponse('Search query is required')
  }

  validateInput(query, MAX_INPUT_LENGTHS.searchQuery, 'Search query')
  const sanitizedQuery = sanitizeAppleScriptString(query.toLowerCase())
  const maxEmails = limit || MAX_RESULTS.emails

  const script = `
tell application "Mail"
  set matchingMsgs to {}
  set msgCount to 0

  repeat with acct in accounts
    set acctName to name of acct

    repeat with mbox in mailboxes of acct
      set mboxName to name of mbox

      try
        repeat with msg in messages of mbox
          if msgCount >= ${maxEmails} then exit repeat

          set msgSubject to subject of msg
          set msgSender to sender of msg
          set msgContent to content of msg

          -- Case-insensitive search in subject, sender, and content
          if (msgSubject contains "${sanitizedQuery}") or (msgSender contains "${sanitizedQuery}") or (msgContent contains "${sanitizedQuery}") then
            set msgDate to date sent of msg as string
            set msgRead to read status of msg

            -- Truncate content for preview
            if (length of msgContent) > ${MAX_RESULTS.contentPreview} then
              set msgContent to (characters 1 thru ${MAX_RESULTS.contentPreview} of msgContent) as string
              set msgContent to msgContent & "..."
            end if

            set msgInfo to {msgSubject:msgSubject, msgSender:msgSender, msgDate:msgDate, msgMailbox:mboxName, msgAccount:acctName, msgContent:msgContent, msgRead:msgRead}
            set end of matchingMsgs to msgInfo
            set msgCount to msgCount + 1
          end if
        end repeat
      on error
        -- Skip problematic mailboxes
      end try

      if msgCount >= ${maxEmails} then exit repeat
    end repeat

    if msgCount >= ${maxEmails} then exit repeat
  end repeat

  return matchingMsgs
end tell`

  logger.debug('Executing search emails', { queryLength: query.length })
  const result = await runAppleScript(script, TIMEOUT_MS.search)

  const emails = parseEmailsResult(result)
  logger.info('Search emails completed', { count: emails.length })

  return successResponse({
    emails: emails.map((email) => ({
      subject: email.subject,
      sender: email.sender,
      dateSent: email.dateSent,
      mailbox: email.mailbox,
      isRead: email.isRead,
      content: truncateContent(email.content, MAX_RESULTS.contentPreview)
    })),
    count: emails.length
  })
}

// Send email (opens Mail.app for user review)
async function sendEmail(to?: string, subject?: string, body?: string): Promise<ToolResponse> {
  if (!to || to.trim() === '') {
    return errorResponse('Recipient email address is required')
  }
  if (!subject || subject.trim() === '') {
    return errorResponse('Email subject is required')
  }
  if (!body || body.trim() === '') {
    return errorResponse('Email body is required')
  }

  // Validate inputs
  validateInput(to, MAX_INPUT_LENGTHS.emailSubject, 'Recipient email')
  validateInput(subject, MAX_INPUT_LENGTHS.emailSubject, 'Email subject')
  validateInput(body, MAX_INPUT_LENGTHS.emailBody, 'Email body')

  // Basic email validation
  if (!/@/.test(to)) {
    return errorResponse('Invalid email address format')
  }

  const sanitizedTo = sanitizeAppleScriptString(to)
  const sanitizedSubject = sanitizeAppleScriptString(subject)
  const sanitizedBody = sanitizeAppleScriptString(body)

  const script = `
tell application "Mail"
  activate
  set newMessage to make new outgoing message with properties {visible:true, subject:"${sanitizedSubject}", content:"${sanitizedBody}"}
  tell newMessage
    make new to recipient at end of to recipients with properties {address:"${sanitizedTo}"}
  end tell

  return "SUCCESS"
end tell`

  logger.debug('Executing send email', {
    subjectLength: subject.length,
    bodyLength: body.length
  })
  const result = await runAppleScript(script, TIMEOUT_MS.send)

  if (result && result.includes('SUCCESS')) {
    logger.info('Send email completed - message opened for review')
    return successResponse({
      success: true,
      message: `Email draft created and opened in Mail.app for review. Please verify and send manually.`,
      to: to,
      subject: subject
    })
  } else {
    return errorResponse(`Failed to create email: ${result || 'Unknown error'}`)
  }
}

// List mailboxes
async function listMailboxes(account?: string): Promise<ToolResponse> {
  const hasAccountFilter = account && account.trim() !== ''
  let sanitizedAccount = ''

  if (hasAccountFilter) {
    validateInput(account, MAX_INPUT_LENGTHS.searchQuery, 'Account name')
    sanitizedAccount = sanitizeAppleScriptString(account)
  }

  const script = `
tell application "Mail"
  set mailboxList to {}
  set mboxCount to 0

  repeat with acct in accounts
    set acctName to name of acct
    ${hasAccountFilter ? `if acctName is not "${sanitizedAccount}" then next repeat` : ''}

    try
      repeat with mbox in mailboxes of acct
        if mboxCount >= ${MAX_RESULTS.mailboxes} then exit repeat

        set mboxName to name of mbox
        set unreadCount to unread count of mbox

        set mboxInfo to {mboxName:mboxName, mboxAccount:acctName, mboxUnreadCount:unreadCount}
        set end of mailboxList to mboxInfo
        set mboxCount to mboxCount + 1
      end repeat
    on error
      -- Skip problematic accounts
    end try

    if mboxCount >= ${MAX_RESULTS.mailboxes} then exit repeat
  end repeat

  return mailboxList
end tell`

  logger.debug('Executing list mailboxes', { hasAccountFilter })
  const result = await runAppleScript(script, TIMEOUT_MS.list)

  const mailboxes = parseMailboxesResult(result)
  logger.info('List mailboxes completed', { count: mailboxes.length })

  return successResponse({
    mailboxes: mailboxes.map((mbox) => ({
      name: mbox.name,
      account: mbox.account,
      unreadCount: mbox.unreadCount
    })),
    count: mailboxes.length
  })
}

// List accounts
async function listAccounts(): Promise<ToolResponse> {
  const script = `
tell application "Mail"
  set accountList to {}

  repeat with acct in accounts
    try
      set acctName to name of acct
      set acctId to id of acct

      set acctInfo to {acctName:acctName, acctId:acctId}
      set end of accountList to acctInfo
    on error
      -- Skip problematic accounts
    end try
  end repeat

  return accountList
end tell`

  logger.debug('Executing list accounts')
  const result = await runAppleScript(script, TIMEOUT_MS.list)

  const accounts = parseAccountsResult(result)
  logger.info('List accounts completed', { count: accounts.length })

  return successResponse({
    accounts: accounts.map((acct) => ({
      name: acct.name,
      id: acct.id
    })),
    count: accounts.length
  })
}

// Get latest emails
async function getLatestEmails(limit?: number): Promise<ToolResponse> {
  const maxEmails = limit || MAX_RESULTS.emails

  const script = `
tell application "Mail"
  set latestMsgs to {}
  set msgCount to 0
  set allMessages to {}

  -- Collect all messages with their date
  repeat with acct in accounts
    set acctName to name of acct

    repeat with mbox in mailboxes of acct
      set mboxName to name of mbox

      try
        repeat with msg in messages of mbox
          set msgDate to date sent of msg
          set msgInfo to {msg:msg, msgDate:msgDate, mbox:mboxName, acct:acctName}
          set end of allMessages to msgInfo
        end repeat
      on error
        -- Skip problematic mailboxes
      end try
    end repeat
  end repeat

  -- Sort by date (newest first) - simplified: just take the last N messages
  -- AppleScript doesn't have easy sorting, so we take from the end
  set msgTotal to count of allMessages
  set startIndex to msgTotal - ${maxEmails} + 1
  if startIndex < 1 then set startIndex to 1

  repeat with i from msgTotal to startIndex by -1
    if msgCount >= ${maxEmails} then exit repeat

    try
      set msgData to item i of allMessages
      set msg to msg of msgData
      set mboxName to mbox of msgData
      set acctName to acct of msgData

      set msgSubject to subject of msg
      set msgSender to sender of msg
      set msgDate to date sent of msg as string
      set msgRead to read status of msg
      set msgContent to content of msg

      -- Truncate content for preview
      if (length of msgContent) > ${MAX_RESULTS.contentPreview} then
        set msgContent to (characters 1 thru ${MAX_RESULTS.contentPreview} of msgContent) as string
        set msgContent to msgContent & "..."
      end if

      set msgInfo to {msgSubject:msgSubject, msgSender:msgSender, msgDate:msgDate, msgMailbox:mboxName, msgAccount:acctName, msgContent:msgContent, msgRead:msgRead}
      set end of latestMsgs to msgInfo
      set msgCount to msgCount + 1
    on error
      -- Skip problematic messages
    end try
  end repeat

  return latestMsgs
end tell`

  logger.debug('Executing get latest emails', { maxEmails })
  const result = await runAppleScript(script, TIMEOUT_MS.list)

  const emails = parseEmailsResult(result)
  logger.info('Get latest emails completed', { count: emails.length })

  return successResponse({
    emails: emails.map((email) => ({
      subject: email.subject,
      sender: email.sender,
      dateSent: email.dateSent,
      mailbox: email.mailbox,
      isRead: email.isRead,
      content: truncateContent(email.content, MAX_RESULTS.contentPreview)
    })),
    count: emails.length
  })
}

// Helper function to parse AppleScript emails result
function parseEmailsResult(result: string): EmailMessage[] {
  try {
    if (!result || result.trim() === '') {
      return []
    }

    const emails: EmailMessage[] = []

    // Pattern to match email records with all fields
    const recordPattern =
      /\{msgSubject:"([^"]*)", msgSender:"([^"]*)", msgDate:"([^"]*)", msgMailbox:"([^"]*)", (?:msgAccount:"([^"]*)", )?msgContent:"([^"]*)"(?:, msgRead:(true|false))?\}/g
    let match

    while ((match = recordPattern.exec(result)) !== null) {
      emails.push({
        id: `${match[1]}-${match[3]}`, // Simple ID from subject + date
        subject: match[1] || 'No Subject',
        sender: match[2] || 'Unknown Sender',
        dateSent: match[3] || '',
        mailbox: match[4] || '',
        content: match[6] || '',
        isRead: match[7] === 'true'
      })
    }

    // If no matches found, try simple parsing for single record
    if (emails.length === 0 && result.includes('msgSubject:')) {
      const subjectMatch = result.match(/msgSubject:"([^"]*)"/)
      const senderMatch = result.match(/msgSender:"([^"]*)"/)
      const dateMatch = result.match(/msgDate:"([^"]*)"/)
      const mailboxMatch = result.match(/msgMailbox:"([^"]*)"/)
      const contentMatch = result.match(/msgContent:"([^"]*)"/)
      const readMatch = result.match(/msgRead:(true|false)/)

      if (subjectMatch) {
        emails.push({
          id: `${subjectMatch[1]}-${dateMatch?.[1] || ''}`,
          subject: subjectMatch[1] || 'No Subject',
          sender: senderMatch?.[1] || 'Unknown Sender',
          dateSent: dateMatch?.[1] || '',
          mailbox: mailboxMatch?.[1] || '',
          content: contentMatch?.[1] || '',
          isRead: readMatch?.[1] === 'true'
        })
      }
    }

    return emails
  } catch (error) {
    logger.error('Failed to parse emails result', { error: (error as Error).message })
    return []
  }
}

// Helper function to parse AppleScript mailboxes result
function parseMailboxesResult(result: string): Mailbox[] {
  try {
    if (!result || result.trim() === '') {
      return []
    }

    const mailboxes: Mailbox[] = []

    // Pattern to match mailbox records
    const recordPattern = /\{mboxName:"([^"]*)", mboxAccount:"([^"]*)", mboxUnreadCount:(\d+)\}/g
    let match

    while ((match = recordPattern.exec(result)) !== null) {
      mailboxes.push({
        name: match[1] || 'Unknown',
        account: match[2] || 'Unknown',
        unreadCount: parseInt(match[3] || '0', 10)
      })
    }

    // If no matches found, try simple parsing
    if (mailboxes.length === 0 && result.includes('mboxName:')) {
      const nameMatch = result.match(/mboxName:"([^"]*)"/)
      const accountMatch = result.match(/mboxAccount:"([^"]*)"/)
      const unreadMatch = result.match(/mboxUnreadCount:(\d+)/)

      if (nameMatch) {
        mailboxes.push({
          name: nameMatch[1] || 'Unknown',
          account: accountMatch?.[1] || 'Unknown',
          unreadCount: parseInt(unreadMatch?.[1] || '0', 10)
        })
      }
    }

    return mailboxes
  } catch (error) {
    logger.error('Failed to parse mailboxes result', { error: (error as Error).message })
    return []
  }
}

// Helper function to parse AppleScript accounts result
function parseAccountsResult(result: string): MailAccount[] {
  try {
    if (!result || result.trim() === '') {
      return []
    }

    const accounts: MailAccount[] = []

    // Pattern to match account records
    const recordPattern = /\{acctName:"([^"]*)", acctId:"([^"]*)"\}/g
    let match

    while ((match = recordPattern.exec(result)) !== null) {
      accounts.push({
        name: match[1] || 'Unknown',
        id: match[2] || ''
      })
    }

    // If no matches found, try simple parsing
    if (accounts.length === 0 && result.includes('acctName:')) {
      const nameMatch = result.match(/acctName:"([^"]*)"/)
      const idMatch = result.match(/acctId:"([^"]*)"/)

      if (nameMatch) {
        accounts.push({
          name: nameMatch[1] || 'Unknown',
          id: idMatch?.[1] || ''
        })
      }
    }

    return accounts
  } catch (error) {
    logger.error('Failed to parse accounts result', { error: (error as Error).message })
    return []
  }
}
