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
      let day = dotMatch[1].padStart(2, '0');
      let month = dotMatch[2].padStart(2, '0');
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
  const events: CalendarEvent[] = [];
  
  if (!$) return [];

  $('.events-list-item.list-event').each((_, element) => {
    // Title often has lots of whitespace/newlines on Exil
    const title = $(element).find('> div > div:first-child').text().replace(/\s+/g, ' ').trim();
    const dateStr = $(element).find('> div > div:nth-child(2)').text().trim();
    const eventUrl = $(element).attr('href');
    
    if (title) {
      events.push({
        id: generateId(),
        club: 'Exil',
        title: title,
        date: parseDate(dateStr),
        eventUrl: eventUrl ? (eventUrl.startsWith('http') ? eventUrl : `${url}${eventUrl}`) : url,
        imageUrl: undefined,
        genres: ['Electronic', 'Club'],
      });
    }
  });

  console.log(`Exil: Scraped ${events.length} events`);
  return events;
}

// Scraper for Mäx
export async function scrapeMaex(): Promise<CalendarEvent[]> {
  const url = 'https://maexzuerich.com';
  const $ = await fetchAndParse(`${url}/events`);
  const events: CalendarEvent[] = [];
  
  if (!$) return [];

  // The site uses a grid. Each direct child of the grid is an event.
  $('div.grid > div').each((_, element) => {
    const titleLink = $(element).find('a[href^="/events/"]:not(:has(img))');
    const title = titleLink.text().replace(/More info/g, '').replace(/\s+/g, ' ').trim();
    
    // Date is in a div with .font-bold, often sibling to the text content
    const dateStr = $(element).find('.font-bold').text().trim();
    const eventUrl = $(element).find('a[href^="/events/"]').attr('href');
    const imageUrl = $(element).find('img').attr('src');
    
    if (title && eventUrl && title !== '') {
      events.push({
        id: generateId(),
        club: 'Mäx',
        title: title,
        date: parseDate(dateStr),
        eventUrl: eventUrl.startsWith('http') ? eventUrl : `${url}${eventUrl}`,
        imageUrl: imageUrl,
        genres: ['Techno', 'House'],
      });
    }
  });

  console.log(`Mäx: Scraped ${events.length} events`);
  return events;
}

// Scraper for Supermarket
export async function scrapeSupermarket(): Promise<CalendarEvent[]> {
  const url = 'https://supermarket.li';
  const $ = await fetchAndParse(`${url}/events/`);
  const events: CalendarEvent[] = [];
  
  if (!$) return [];

  // Supermarket uses Elementor. These containers hold the event cards.
  $('.elementor-element.e-con-full.e-flex.e-con.e-parent').each((_, element) => {
    const titleLink = $(element).find('a[href*="/events/"]');
    const title = titleLink.first().text().replace(/\s+/g, ' ').trim();
    
    // Date is often the first text node or a specific heading in the container
    // Let's try to find it by looking for the "FR" / "SA" etc.
    let dateStr = $(element).text().match(/(MO|DI|MI|DO|FR|SA|SO)\s\d{1,2}\s[A-ZÄ]+/i)?.[0] || "";
    
    const eventUrl = titleLink.attr('href');
    const imageUrl = $(element).find('img').attr('src');
    
    // Filter out image-only titles or empty titles
    if (title && eventUrl && title !== '' && !title.startsWith('<img')) {
      events.push({
        id: generateId(),
        club: 'Supermarket',
        title: title,
        date: parseDate(dateStr),
        eventUrl: eventUrl.startsWith('http') ? eventUrl : `${url}${eventUrl}`,
        imageUrl: imageUrl,
        genres: ['Deep House', 'Electronic'],
      });
    }
  });

  console.log(`Supermarket: Scraped ${events.length} events`);
  return events;
}

/**
 * Main scraper runner that aggregates all clubs
 */
export async function runAllScrapers(): Promise<CalendarEvent[]> {
  const results = await Promise.all([
    scrapeExil(),
    scrapeMaex(),
    scrapeSupermarket()
  ]);

  // Flatten the array of arrays
  return results.flat();
}
