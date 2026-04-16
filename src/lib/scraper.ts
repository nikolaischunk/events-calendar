import * as cheerio from 'cheerio';
import { CalendarEvent, ClubName } from './types';
import crypto from 'crypto';
import { getCachedEventDetail, setCachedEventDetail, type CachedEventDetail } from './kv';

// Minimal helper to generate unique IDs
const generateId = () => crypto.randomBytes(16).toString('hex');

// Generic Fetch and Parse Helper
async function fetchAndParse(url: string) {
    try {
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; ZurichEventsBot/1.0)',
            },
        });

        if (!response.ok) {
            throw new Error(`Failed to fetch ${url}: ${response.statusText}`);
        }

        const html = await response.text();
        return cheerio.load(html);
    } catch (error) {
        console.error(`Error scraping ${url}:`, error);
        return null;
    }
}

type FetchRetryOptions = {
    timeoutMs: number;
    retries: number;
    retryDelayBaseMs: number;
};

async function fetchTextWithRetry(url: string, opts: FetchRetryOptions): Promise<string> {
    let lastError: unknown = null;
    for (let attempt = 0; attempt <= opts.retries; attempt++) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), opts.timeoutMs);
        try {
            const response = await fetch(url, {
                signal: controller.signal,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (compatible; ZurichEventsBot/1.0)',
                },
            });
            if (!response.ok) {
                throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
            }
            return await response.text();
        } catch (error) {
            lastError = error;
            const delayMs = Math.min(8000, opts.retryDelayBaseMs * Math.pow(2, attempt));
            await new Promise((r) => setTimeout(r, delayMs));
        } finally {
            clearTimeout(timeout);
        }
    }
    throw lastError instanceof Error ? lastError : new Error(`Failed to fetch ${url}`);
}

async function fetchAndParseWithRetry(url: string, opts: FetchRetryOptions): Promise<cheerio.CheerioAPI | null> {
    try {
        const html = await fetchTextWithRetry(url, opts);
        return cheerio.load(html);
    } catch (error) {
        console.error(`Error scraping ${url}:`, error);
        return null;
    }
}

// Helper to ensure absolute URLs
function makeAbsolute(url: string, baseUrl: string): string {
    if (!url) return '';
    if (url.startsWith('http')) return url;
    const base = new URL(baseUrl);
    return `${base.protocol}//${base.host}${url.startsWith('/') ? '' : '/'}${url}`;
}

function parseSrcsetFirstUrl(srcset: string): string | undefined {
    if (!srcset) return undefined;
    // srcset := "url1 640w, url2 750w"  OR  "url1 1x, url2 2x"
    const first = srcset.split(',')[0]?.trim();
    if (!first) return undefined;
    const urlPart = first.split(/\s+/)[0]?.trim();
    return urlPart || undefined;
}

function extractBackgroundImageUrl(style: string): string | undefined {
    if (!style) return undefined;
    const match = style.match(/background-image\s*:\s*url\((['"]?)(.*?)\1\)/i);
    const url = match?.[2]?.trim();
    return url || undefined;
}

function extractImageUrlFromContainer(
    $: cheerio.CheerioAPI,
    container: cheerio.Cheerio<cheerio.Element>,
    baseUrl: string
): string | undefined {
    // Prefer actual <img> nodes (lazy-load attributes first), then CSS background images.
    const imgs = container.find('img');
    for (const imgEl of imgs.toArray()) {
        const img = $(imgEl);
        const candidates = [
            img.attr('data-src'),
            img.attr('data-lazy-src'),
            img.attr('data-original'),
            img.attr('data-srcset') ? parseSrcsetFirstUrl(img.attr('data-srcset')!) : undefined,
            img.attr('srcset') ? parseSrcsetFirstUrl(img.attr('srcset')!) : undefined,
            img.attr('src'),
        ].filter(Boolean) as string[];

        for (const candidate of candidates) {
            const trimmed = candidate.trim();
            if (!trimmed) continue;
            if (trimmed.startsWith('data:')) continue;
            return makeAbsolute(trimmed, baseUrl);
        }
    }

    const containerStyleUrl = extractBackgroundImageUrl(container.attr('style') || '');
    if (containerStyleUrl) return makeAbsolute(containerStyleUrl, baseUrl);

    const bgEl = container.find('[style*="background-image"]').first();
    const bgStyleUrl = extractBackgroundImageUrl(bgEl.attr('style') || '');
    if (bgStyleUrl) return makeAbsolute(bgStyleUrl, baseUrl);

    return undefined;
}

/**
 * Helper to parse various Swiss event date formats into ISO strings
 */
function parseDate(dateStr: string): string {
    if (!dateStr) return new Date().toISOString();

    try {
        // 1. Handle "DD.MM.YYYY" or "DD.MM.YY" (common in CH)
        const dotRegex = /(\d{1,2})\.(\d{1,2})\.(\d{2,4})/;
        const dotMatch = dateStr.match(dotRegex);
        if (dotMatch) {
            const day = dotMatch[1].padStart(2, '0');
            const month = dotMatch[2].padStart(2, '0');
            let year = dotMatch[3];
            if (year.length === 2) year = `20${year}`;
            return new Date(`${year}-${month}-${day}T22:00:00Z`).toISOString();
        }

        // 2. Handle "DD APRIL" style (Supermarket)
        const monthMap: { [key: string]: string } = {
            'JANUAR': '01', 'JANUARY': '01', 'JAN': '01',
            'FEBRUAR': '02', 'FEBRUARY': '02', 'FEB': '02',
            'MÄRZ': '03', 'MARCH': '03', 'MAR': '03',
            'APRIL': '04', 'APR': '04',
            'MAI': '05', 'MAY': '05',
            'JUNI': '06', 'JUNE': '06', 'JUN': '06',
            'JULI': '07', 'JULY': '07', 'JUL': '07',
            'AUGUST': '08', 'AUG': '08',
            'SEPTEMBER': '09', 'SEP': '09',
            'OKTOBER': '10', 'OCTOBER': '10', 'OCT': '10',
            'NOVEMBER': '11', 'NOV': '11',
            'DEZEMBER': '12', 'DECEMBER': '12', 'DEC': '12'
        };

        const textMonthRegex = /(\d{1,2})\s([A-ZÄ]+)/i;
        const textMonthMatch = dateStr.match(textMonthRegex);
        if (textMonthMatch) {
            const day = textMonthMatch[1].padStart(2, '0');
            const monthName = textMonthMatch[2].toUpperCase();
            const month = monthMap[monthName];
            if (month) {
                const year = new Date().getFullYear();
                return new Date(`${year}-${month}-${day}T22:00:00Z`).toISOString();
            }
        }

        // Fallback to standard JS Date
        const d = new Date(dateStr);
        if (!isNaN(d.getTime())) return d.toISOString();
    } catch (e) {
        console.warn(`Failed to parse date: ${dateStr}`, e);
    }

    return new Date().toISOString();
}

function safeTrim(text: string | undefined | null): string {
    return (text || '').replace(/\s+/g, ' ').trim();
}

function uniqStrings(values: Array<string | undefined | null>): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const v of values) {
        const t = safeTrim(v);
        if (!t) continue;
        const key = t.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(t);
    }
    return out;
}

function parseJsonLdObjects($: cheerio.CheerioAPI): unknown[] {
    const objects: unknown[] = [];
    $('script[type="application/ld+json"]').each((_, el) => {
        const raw = $(el).text();
        if (!raw) return;
        try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) objects.push(...parsed);
            else objects.push(parsed);
        } catch {
            // ignore invalid JSON-LD blobs
        }
    });
    return objects;
}

function findEventJsonLd(objects: unknown[]): Record<string, unknown> | null {
    for (const obj of objects) {
        if (!obj || typeof obj !== 'object') continue;
        const record = obj as Record<string, unknown>;
        const type = record['@type'];
        if (typeof type === 'string' && type.toLowerCase().includes('event')) return record;
        if (Array.isArray(type) && type.some((t) => typeof t === 'string' && t.toLowerCase().includes('event'))) return record;
        // Sometimes it's nested under @graph
        const graph = record['@graph'];
        if (Array.isArray(graph)) {
            const nested = findEventJsonLd(graph);
            if (nested) return nested;
        }
    }
    return null;
}

function normalizeGenres(genres: unknown): string[] {
    if (!genres) return [];
    if (Array.isArray(genres)) return uniqStrings(genres.map((g) => (typeof g === 'string' ? g : null)));
    if (typeof genres === 'string') {
        return uniqStrings(
            genres
                .split(/[,/|·•]+/g)
                .map((s) => s.trim())
        );
    }
    return [];
}

function isPlausibleGenre(value: string): boolean {
    const s = safeTrim(value);
    if (!s) return false;
    if (s.length < 2 || s.length > 30) return false;
    if (/\d/.test(s)) return false;
    if (/[<>]/.test(s)) return false;
    const lower = s.toLowerCase();
    if (lower === 'genrepickx') return false;
    if (['instagram', 'facebook', 'tiktok', 'youtube', 'soundcloud'].includes(lower)) return false;
    const stop = [
        'januar',
        'februar',
        'märz',
        'maerz',
        'april',
        'mai',
        'juni',
        'july',
        'juli',
        'august',
        'september',
        'oktober',
        'november',
        'dezember',
        'monday',
        'tuesday',
        'wednesday',
        'thursday',
        'friday',
        'saturday',
        'sunday',
        'montag',
        'dienstag',
        'mittwoch',
        'donnerstag',
        'freitag',
        'samstag',
        'sonntag',
    ];
    if (stop.includes(lower)) return false;
    if (/pres\.|present|set\b|live\b|doors?\b|start\b/i.test(s)) return false;
    const words = lower.split(/\s+/g).filter(Boolean);
    if (words.length > 3) return false;
    return true;
}

function extractArtistsFromJsonLd(event: Record<string, unknown>): string[] {
    const performer = event['performer'] ?? event['performers'];
    const collectName = (p: unknown): string | null => {
        if (!p) return null;
        if (typeof p === 'string') return p;
        if (typeof p === 'object') {
            const name = (p as Record<string, unknown>)['name'];
            if (typeof name === 'string') return name;
        }
        return null;
    };
    if (Array.isArray(performer)) return uniqStrings(performer.map(collectName));
    return uniqStrings([collectName(performer)]);
}

function extractTicketUrlFromJsonLd(event: Record<string, unknown>): string | undefined {
    const offers = event['offers'];
    const extract = (o: unknown): string | undefined => {
        if (!o) return undefined;
        if (typeof o === 'string') return o;
        if (typeof o === 'object') {
            const url = (o as Record<string, unknown>)['url'];
            if (typeof url === 'string') return url;
        }
        return undefined;
    };
    if (Array.isArray(offers)) return extract(offers[0]);
    return extract(offers);
}

function extractTimesFromText(text: string): { doorsTime?: string; startTime?: string } {
    const doors = text.match(/doors?\s*(?:open)?\s*[:\-]?\s*(\d{1,2}:\d{2})/i)?.[1];
    const start = text.match(/start\s*[:\-]?\s*(\d{1,2}:\d{2})/i)?.[1];
    return {
        doorsTime: doors,
        startTime: start,
    };
}

function extractFallbackGenres($: cheerio.CheerioAPI): string[] {
    const fromTags = $('a[rel="tag"], a[href*="/tag/"], a[href*="genre"]').toArray().map((el) => $(el).text());
    const fromLabeled = $('[class*="genre"], [class*="tag"]').toArray().map((el) => $(el).text());
    return uniqStrings(
        [...fromTags, ...fromLabeled]
            .flatMap((t) => safeTrim(t).split(/[,/|·•]+/g))
            .map((s) => s.trim())
            .filter(Boolean)
            .filter(isPlausibleGenre)
    );
}

function extractTicketUrlFromDom($: cheerio.CheerioAPI, baseUrl: string): string | undefined {
    const candidates = $('a[href]')
        .toArray()
        .map((el) => {
            const a = $(el);
            const href = a.attr('href') || '';
            const text = safeTrim(a.text()).toLowerCase();
            return { href, text };
        })
        .filter((c) => c.href && !c.href.startsWith('#'))
        .filter((c) => c.href.toLowerCase().includes('ticket') || c.text.includes('ticket') || c.text.includes('tickets') || c.text.includes('vorverkauf'));

    const first = candidates[0]?.href;
    return first ? makeAbsolute(first, baseUrl) : undefined;
}

function mergeDetailIntoEvent(event: CalendarEvent, detail: CachedEventDetail): CalendarEvent {
    const cleanedGenres = (detail.genres || []).filter(isPlausibleGenre);
    return {
        ...event,
        date: detail.date || event.date,
        genres: cleanedGenres.length > 0 ? cleanedGenres : event.genres,
        description: detail.description || event.description,
        artists: detail.artists && detail.artists.length > 0 ? detail.artists : event.artists,
        ticketUrl: detail.ticketUrl || event.ticketUrl,
        imageUrl: detail.imageUrl || event.imageUrl,
        doorsTime: detail.doorsTime || event.doorsTime,
        startTime: detail.startTime || event.startTime,
    };
}

function kvAvailable(): boolean {
    return Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
}

function extractSectionTextAfterHeading($: cheerio.CheerioAPI, headingRegex: RegExp): string | undefined {
    const heading = $('h1,h2,h3,h4,strong')
        .toArray()
        .map((el) => $(el))
        .find((h) => headingRegex.test(safeTrim(h.text())));
    if (!heading) return undefined;

    const container = heading.closest('section, article, div');
    if (container && container.length) {
        const text = safeTrim(container.text());
        return text || undefined;
    }

    const next = heading.parent().next();
    const text = safeTrim(next.text());
    return text || undefined;
}

function parseArtistsFromText(text: string | undefined): string[] {
    if (!text) return [];
    return uniqStrings(
        text
            .split(/\n|,|·|•|\||\u2022/g)
            .map((s) => safeTrim(s))
            .filter(Boolean)
            .filter((s) => s.length <= 80)
    );
}

function parseDetailByClub(
    club: ClubName,
    $: cheerio.CheerioAPI,
    eventUrl: string
): Partial<CachedEventDetail> {
    if (club === 'Exil') {
        const imageRelative = $('meta[property="og:image"]').attr('content') || $('.img-top.img-square').attr('src');
        const imageUrl = imageRelative ? makeAbsolute(imageRelative, eventUrl) : undefined;

        const description =
            safeTrim($('.event-description, .event__content, .event__text, .content, article').first().text()) ||
            undefined;

        const lineupText = extractSectionTextAfterHeading($, /line\s*up|artists?/i);
        const artists = parseArtistsFromText(lineupText);

        const ticketUrl =
            extractTicketUrlFromDom($, eventUrl) ||
            $('a[href*="ticket"]').first().attr('href') ||
            undefined;

        const genres = uniqStrings(
            $('.event-genre, .genres, [class*="genre"], [class*="tag"]')
                .toArray()
                .map((el) => $(el).text())
                .flatMap((t) => safeTrim(t).split(/[,/|·•]+/g))
        ).filter(isPlausibleGenre);

        return {
            imageUrl,
            description,
            artists: artists.length > 0 ? artists : undefined,
            ticketUrl: ticketUrl ? makeAbsolute(ticketUrl, eventUrl) : undefined,
            genres: genres.length > 0 ? genres : undefined,
        };
    }

    if (club === 'Mäx') {
        const description =
            safeTrim($('meta[property="og:description"]').attr('content')) ||
            safeTrim($('.prose, article, main').first().text()) ||
            undefined;

        const genres = uniqStrings(
            $('a[rel="tag"], [class*="tag"], [class*="badge"]')
                .toArray()
                .map((el) => $(el).text())
                .flatMap((t) => safeTrim(t).split(/[,/|·•]+/g))
        ).filter(isPlausibleGenre);

        const artists = parseArtistsFromText(extractSectionTextAfterHeading($, /line\s*up|artists?|djs?/i));

        return {
            description,
            genres: genres.length > 0 ? genres : undefined,
            artists: artists.length > 0 ? artists : undefined,
        };
    }

    if (club === 'Supermarket') {
        const content = $('.elementor-widget-theme-post-content, .elementor-widget-container, article').first();
        const description = content.length ? safeTrim(content.text()) || undefined : undefined;

        const artists = parseArtistsFromText(extractSectionTextAfterHeading($, /line\s*up|artists?|djs?/i));

        const ticketUrl =
            extractTicketUrlFromDom($, eventUrl) ||
            $('a[href*="ticket"]').first().attr('href') ||
            undefined;

        return {
            description,
            artists: artists.length > 0 ? artists : undefined,
            ticketUrl: ticketUrl ? makeAbsolute(ticketUrl, eventUrl) : undefined,
        };
    }

    return {};
}

async function enrichEventFromDetail(event: CalendarEvent): Promise<CalendarEvent> {
    if (!event.eventUrl) return event;

    const cacheTtlSeconds = Number(process.env.SCRAPE_DETAIL_CACHE_TTL_SECONDS || 60 * 60 * 12);
    if (kvAvailable()) {
        const cached = await getCachedEventDetail(event.eventUrl);
        if (cached) return mergeDetailIntoEvent(event, cached);
    }

    const $detail = await fetchAndParseWithRetry(event.eventUrl, {
        timeoutMs: Number(process.env.SCRAPE_DETAIL_TIMEOUT_MS || 12000),
        retries: Number(process.env.SCRAPE_DETAIL_RETRIES || 2),
        retryDelayBaseMs: Number(process.env.SCRAPE_DETAIL_RETRY_DELAY_BASE_MS || 400),
    });
    if (!$detail) return event;

    const jsonLdObjects = parseJsonLdObjects($detail);
    const jsonLdEvent = findEventJsonLd(jsonLdObjects);

    const ogImage = $detail('meta[property="og:image"]').attr('content');
    const ogDescription = $detail('meta[property="og:description"]').attr('content');
    const metaDescription = $detail('meta[name="description"]').attr('content');

    const description = safeTrim(
        (typeof jsonLdEvent?.description === 'string' ? (jsonLdEvent.description as string) : undefined) ||
            ogDescription ||
            metaDescription
    );

    const ticketUrl =
        (jsonLdEvent ? extractTicketUrlFromJsonLd(jsonLdEvent) : undefined) ||
        extractTicketUrlFromDom($detail, event.eventUrl) ||
        undefined;

    const genres =
        (jsonLdEvent ? normalizeGenres(jsonLdEvent.genre) : []) || [];

    const artists = jsonLdEvent ? extractArtistsFromJsonLd(jsonLdEvent) : [];

    const dateFromJsonLd = typeof jsonLdEvent?.startDate === 'string' ? (jsonLdEvent.startDate as string) : undefined;
    const normalizedDate = dateFromJsonLd ? new Date(dateFromJsonLd).toISOString() : undefined;

    const bodyText = safeTrim($detail('body').text());
    const { doorsTime, startTime } = extractTimesFromText(bodyText);

    const cleanedJsonLdGenres = genres.filter(isPlausibleGenre);
    const fallbackGenres = cleanedJsonLdGenres.length > 0 ? cleanedJsonLdGenres : extractFallbackGenres($detail);
    const imageUrl = ogImage ? makeAbsolute(ogImage, event.eventUrl) : event.imageUrl;

    const clubDetail = parseDetailByClub(event.club, $detail, event.eventUrl);

    const detail: CachedEventDetail = {
        fetchedAt: new Date().toISOString(),
        genres: clubDetail.genres && clubDetail.genres.length > 0 ? clubDetail.genres : fallbackGenres,
        description: clubDetail.description || description || undefined,
        artists: clubDetail.artists && clubDetail.artists.length > 0 ? clubDetail.artists : artists.length > 0 ? artists : undefined,
        ticketUrl: clubDetail.ticketUrl || ticketUrl,
        imageUrl: clubDetail.imageUrl || imageUrl,
        date: normalizedDate,
        doorsTime: clubDetail.doorsTime || doorsTime,
        startTime: clubDetail.startTime || startTime,
    };

    if (kvAvailable()) {
        await setCachedEventDetail(event.eventUrl, detail, cacheTtlSeconds);
    }

    return mergeDetailIntoEvent(event, detail);
}

async function asyncPool<T, R>(items: T[], concurrency: number, worker: (item: T) => Promise<R>): Promise<R[]> {
    const results: R[] = new Array(items.length) as R[];
    let idx = 0;

    const runners = new Array(Math.min(concurrency, items.length)).fill(0).map(async () => {
        while (true) {
            const current = idx++;
            if (current >= items.length) return;
            results[current] = await worker(items[current]);
        }
    });

    await Promise.all(runners);
    return results;
}

// Scraper for Exil
export async function scrapeExil(): Promise<CalendarEvent[]> {
    const url = 'https://exil.club';
    const $ = await fetchAndParse(url);

    if (!$) return [];

    const listItems = $('.events-list-item.list-event');

    const eventPromises = listItems.map(async (_, element) => {
        const title = $(element).find('> div > div:first-child').text().replace(/\s+/g, ' ').trim();
        const dateStr = $(element).find('> div > div:nth-child(2)').text().trim();
        const relativeUrl = $(element).attr('href');
        const eventUrl = relativeUrl ? (relativeUrl.startsWith('http') ? relativeUrl : `${url}${relativeUrl}`) : url;

        if (title) {
            return {
                id: generateId(),
                club: 'Exil' as ClubName,
                title: title,
                date: parseDate(dateStr),
                eventUrl: eventUrl,
                genres: [],
            };
        }
        return null;
    }).get();

    const results = await Promise.all(eventPromises);
    const filteredEvents = results.filter((e): e is CalendarEvent => e !== null);

    console.log(`Exil: Scraped ${filteredEvents.length} events`);
    return filteredEvents;
}

// Scraper for Mäx
export async function scrapeMaex(): Promise<CalendarEvent[]> {
    const url = 'https://maexzuerich.com';
    const $ = await fetchAndParse(`${url}/events`);
    const events: CalendarEvent[] = [];

    if (!$) return [];

    // Mäx renders each event across multiple grid children (some without the image).
    // Aggregate by event URL and then pick the best title/date/image nodes.
    const eventUrlSet = new Set<string>();
    $('a[href^="/events/"]').each((_, el) => {
        const href = $(el).attr('href');
        if (!href) return;
        eventUrlSet.add(makeAbsolute(href, url));
    });

    for (const eventUrl of eventUrlSet) {
        const relative = eventUrl.replace(url, '');
        const anchors = $(`a[href="${relative}"], a[href="${eventUrl}"]`);

        const titleAnchor = anchors
            .filter((_, el) => {
                const a = $(el);
                const text = a.text().replace(/More info/g, '').trim();
                if (!text) return false;
                if (a.find('img').length > 0) return false;
                return true;
            })
            .first();

        const title = titleAnchor.text().replace(/More info/g, '').replace(/\s+/g, ' ').trim();
        if (!title) continue;

        const container =
            titleAnchor.closest('div.grid > div').length > 0
                ? titleAnchor.closest('div.grid > div')
                : titleAnchor.closest('div');

        const dateStr = container.find('.font-bold').first().text().trim();

        const imageAnchor = anchors.has('img').first();
        const imageUrl = imageAnchor.length
            ? extractImageUrlFromContainer($, imageAnchor, url)
            : extractImageUrlFromContainer($, container, url);

        events.push({
            id: generateId(),
            club: 'Mäx',
            title,
            date: parseDate(dateStr),
            eventUrl,
            imageUrl,
            genres: [],
        });
    }

    console.log(`Mäx: Scraped ${events.length} events`);
    return events;
}

// Scraper for Supermarket
export async function scrapeSupermarket(): Promise<CalendarEvent[]> {
    const url = 'https://supermarket.li';
    const $ = await fetchAndParse(`${url}/events/`);
    const events: CalendarEvent[] = [];

    if (!$) return [];

    // Supermarket uses Elementor; the featured image and title often live in separate blocks.
    // We aggregate by event URL and then pick title/date/image from the best matching nodes.
    const eventUrlSet = new Set<string>();
    $('a[href*="/events/"]').each((_, el) => {
        const href = $(el).attr('href');
        if (!href) return;
        const absolute = makeAbsolute(href, url);
        // Skip the index page itself.
        if (absolute.replace(/\/+$/, '') === `${url}/events`) return;
        eventUrlSet.add(absolute);
    });

    for (const eventUrl of eventUrlSet) {
        const anchors = $(`a[href="${eventUrl}"]`);
        const titleAnchor = anchors
            .filter((_, el) => {
                const a = $(el);
                const text = a.text().trim();
                if (!text) return false;
                if (text.toLowerCase() === 'tickets') return false;
                if (a.find('img').length > 0) return false;
                return true;
            })
            .first();
        const title = titleAnchor.text().replace(/\s+/g, ' ').trim();
        if (!title) continue;

        const dateContainer =
            titleAnchor.closest('.e-con').length > 0
                ? titleAnchor.closest('.e-con')
                : titleAnchor.closest('.elementor-element');
        const dateStr =
            dateContainer.text().match(/(MO|DI|MI|DO|FR|SA|SO)\s\d{1,2}\s[A-ZÄ]+/i)?.[0] || '';

        const imageAnchor = anchors.has('img').first();
        const imageUrl = imageAnchor.length ? extractImageUrlFromContainer($, imageAnchor, url) : undefined;

        events.push({
            id: generateId(),
            club: 'Supermarket',
            title,
            date: parseDate(dateStr),
            eventUrl,
            imageUrl,
            genres: [],
        });
    }

    console.log(`Supermarket: Scraped ${events.length} events`);
    return events;
}

/**
 * Main scraper runner that aggregates all clubs
 */
export async function runAllScrapers(): Promise<CalendarEvent[]> {
    const scrapers = [
        { name: 'Exil', fn: scrapeExil },
        { name: 'Mäx', fn: scrapeMaex },
        { name: 'Supermarket', fn: scrapeSupermarket }
    ];

    const results = await Promise.all(
        scrapers.map(async (scraper) => {
            try {
                return await scraper.fn();
            } catch (error) {
                console.error(`Error in scraper ${scraper.name}:`, error);
                return [];
            }
        })
    );

    const discovered = results.flat();

    const concurrency = Number(process.env.SCRAPE_DETAIL_CONCURRENCY || 8);
    const inRunCache = new Map<string, Promise<CalendarEvent>>();

    const enriched = await asyncPool(discovered, concurrency, async (evt) => {
        const key = evt.eventUrl || `${evt.club}:${evt.title}:${evt.date}`;
        const existing = inRunCache.get(key);
        if (existing) return existing;
        const promise = enrichEventFromDetail(evt);
        inRunCache.set(key, promise);
        return promise;
    });

    return enriched;
}
