/**
 * Single source of truth for which static reminder sources fire.
 * Order in this array is the order blocks render in the user message.
 * Add new sources by appending to this array — collectStaticReminders
 * does the rest.
 */

import type { StaticReminderSource } from '../types'
import { agentsMdSource } from './agentsMdSource'

export const STATIC_REMINDER_SOURCES: StaticReminderSource[] = [agentsMdSource]
