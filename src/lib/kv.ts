import { Redis } from '@upstash/redis';
import { CalendarEvent } from './types';
import crypto from 'crypto';

const kv = Redis.fromEnv();

// Used to prefix our keys to keep the KV store organized
const EVENTS_KEY = 'events:all';
const EVENT_DETAIL_PREFIX = 'eventDetail:';

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

export interface CachedEventDetail {
  fetchedAt: string; // ISO string
  genres?: string[];
  description?: string;
  artists?: string[];
  ticketUrl?: string;
  imageUrl?: string;
  date?: string; // ISO (optional override if detail provides a better datetime)
  doorsTime?: string;
  startTime?: string;
}

function eventDetailKey(eventUrl: string): string {
  const hash = crypto.createHash('sha1').update(eventUrl).digest('hex');
  return `${EVENT_DETAIL_PREFIX}${hash}`;
}

export async function getCachedEventDetail(eventUrl: string): Promise<CachedEventDetail | null> {
  try {
    const key = eventDetailKey(eventUrl);
    const cached = await kv.get<CachedEventDetail>(key);
    return cached || null;
  } catch (error) {
    console.error('Failed to get cached event detail from KV:', error);
    return null;
  }
}

export async function setCachedEventDetail(eventUrl: string, detail: CachedEventDetail, ttlSeconds: number) {
  try {
    const key = eventDetailKey(eventUrl);
    // Upstash supports SET with EX in options; keep this loosely typed to avoid SDK type drift.
    await (kv as unknown as { set: (k: string, v: unknown, opts?: unknown) => Promise<unknown> }).set(key, detail, {
      ex: ttlSeconds,
    });
  } catch (error) {
    console.error('Failed to set cached event detail in KV:', error);
  }
}
