import * as cheerio from 'cheerio';
import { CalendarEvent, ClubName } from './types';
import crypto from 'crypto';

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

// Scraper for Exil
export async function scrapeExil(): Promise<CalendarEvent[]> {
    const url = 'https://exil.club';
    const $ = await fetchAndParse(url);

    if (!$) return [];

    const listItems = $('.events-list-item.list-event');

    // We need to fetch detail pages for Exil because images aren't on the list page
    const eventPromises = listItems.map(async (_, element) => {
        const title = $(element).find('> div > div:first-child').text().replace(/\s+/g, ' ').trim();
        const dateStr = $(element).find('> div > div:nth-child(2)').text().trim();
        const relativeUrl = $(element).attr('href');
        const eventUrl = relativeUrl ? (relativeUrl.startsWith('http') ? relativeUrl : `${url}${relativeUrl}`) : url;

        if (title) {
            // Fetch detail page for image
            const $detail = await fetchAndParse(eventUrl);
            const imageUrlRelative = $detail ? ($detail('meta[property="og:image"]').attr('content') || $detail('.img-top.img-square').attr('src')) : undefined;
            const imageUrl = imageUrlRelative ? makeAbsolute(imageUrlRelative, url) : undefined;

            return {
                id: generateId(),
                club: 'Exil' as ClubName,
                title: title,
                date: parseDate(dateStr),
                eventUrl: eventUrl,
                imageUrl: imageUrl,
                genres: ['Electronic', 'Club'],
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
            genres: ['Techno', 'House'],
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
            genres: ['Deep House', 'Electronic'],
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

    // Flatten the array of arrays
    return results.flat();
}
