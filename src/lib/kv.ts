import { Redis } from '@upstash/redis';
import { CalendarEvent } from './types';

const kv = Redis.fromEnv();

// Used to prefix our keys to keep the KV store organized
const EVENTS_KEY = 'events:all';

/**
 * Save scraped events to KV
 * This replaces existing events completely or we can merge them.
 * For a simple calendar, replacing them or updating them by ID works.
 * Here we replace the whole list for simplicity.
 */
export async function saveEvents(events: CalendarEvent[]) {
  // Store them as a list/JSON
  await kv.set(EVENTS_KEY, events);
}

/**
 * Retrieve events from KV
 */
export async function getEvents(): Promise<CalendarEvent[]> {
  try {
    const events = await kv.get<CalendarEvent[]>(EVENTS_KEY);
    return events || [];
  } catch (error) {
    console.error('Failed to get events from KV:', error);
    return [];
  }
}
