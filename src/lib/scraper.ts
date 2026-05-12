import * as cheerio from "cheerio";
import type { Element } from "domhandler";
import { CalendarEvent, ClubName } from "./types";
import crypto from "crypto";
import {
  getCachedEventDetail,
  setCachedEventDetail,
  type CachedEventDetail,
} from "./kv";

// Minimal helper to generate unique IDs
const generateId = () => crypto.randomBytes(16).toString("hex");

const WEEKENDLY_BASE_URL = "https://weekendly.ch";
const WEEKENDLY_ZURICH_CLUBS_URL = `${WEEKENDLY_BASE_URL}/clubs/zurich`;
const GERMAN_DAY_PATTERN =
  "(?:mo|di|mi|do|fr|sa|so|montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)";
const GERMAN_RELATIVE_DAY_PATTERN = "(?:heute|morgen)";
const WEEKENDLY_DATE_LINE_REGEX = new RegExp(
  `${GERMAN_RELATIVE_DAY_PATTERN}|mo\\.|di\\.|mi\\.|do\\.|fr\\.|sa\\.|so\\.`,
  "i",
);

function buildFetchHeaders(url: string): Record<string, string> {
  const headers: Record<string, string> = {
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  };

  if (url.includes("weekendly.ch")) {
    headers["Accept"] =
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8";
    headers["Accept-Language"] = "de-CH,de;q=0.9,en;q=0.8";
    headers["Cache-Control"] = "no-cache";
    headers["Pragma"] = "no-cache";
    headers["Upgrade-Insecure-Requests"] = "1";
  }

  return headers;
}

// Generic Fetch and Parse Helper
async function fetchAndParse(url: string) {
  try {
    const response = await fetch(url, {
      headers: buildFetchHeaders(url),
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

async function fetchTextWithRetry(
  url: string,
  opts: FetchRetryOptions,
): Promise<string> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt <= opts.retries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), opts.timeoutMs);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: buildFetchHeaders(url),
      });
      if (!response.ok) {
        throw new Error(
          `Failed to fetch ${url}: ${response.status} ${response.statusText}`,
        );
      }
      return await response.text();
    } catch (error) {
      lastError = error;
      const delayMs = Math.min(
        8000,
        opts.retryDelayBaseMs * Math.pow(2, attempt),
      );
      await new Promise((r) => setTimeout(r, delayMs));
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(`Failed to fetch ${url}`);
}

async function fetchAndParseWithRetry(
  url: string,
  opts: FetchRetryOptions,
): Promise<cheerio.CheerioAPI | null> {
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
  if (!url) return "";
  if (url.startsWith("http")) return url;
  const base = new URL(baseUrl);
  return `${base.protocol}//${base.host}${url.startsWith("/") ? "" : "/"}${url}`;
}

function parseSrcsetFirstUrl(srcset: string): string | undefined {
  if (!srcset) return undefined;
  // srcset := "url1 640w, url2 750w"  OR  "url1 1x, url2 2x"
  const first = srcset.split(",")[0]?.trim();
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
  container: cheerio.Cheerio<Element>,
  baseUrl: string,
): string | undefined {
  // Prefer actual <img> nodes (lazy-load attributes first), then CSS background images.
  const imgs = container.find("img");
  for (const imgEl of imgs.toArray()) {
    const img = $(imgEl);
    const candidates = [
      img.attr("data-src"),
      img.attr("data-lazy-src"),
      img.attr("data-original"),
      img.attr("data-srcset")
        ? parseSrcsetFirstUrl(img.attr("data-srcset")!)
        : undefined,
      img.attr("srcset") ? parseSrcsetFirstUrl(img.attr("srcset")!) : undefined,
      img.attr("src"),
    ].filter(Boolean) as string[];

    for (const candidate of candidates) {
      const trimmed = candidate.trim();
      if (!trimmed) continue;
      if (trimmed.startsWith("data:")) continue;
      return makeAbsolute(trimmed, baseUrl);
    }
  }

  const containerStyleUrl = extractBackgroundImageUrl(
    container.attr("style") || "",
  );
  if (containerStyleUrl) return makeAbsolute(containerStyleUrl, baseUrl);

  const bgEl = container.find('[style*="background-image"]').first();
  const bgStyleUrl = extractBackgroundImageUrl(bgEl.attr("style") || "");
  if (bgStyleUrl) return makeAbsolute(bgStyleUrl, baseUrl);

  return undefined;
}

/**
 * Helper to parse various Swiss event date formats into ISO strings
 */
function parseDate(dateStr: string): string {
  if (!dateStr) return new Date().toISOString();

  try {
    const normalized = safeTrim(dateStr);
    const now = new Date();
    const timeMatch = normalized.match(/(\d{1,2}):(\d{2})/);
    // Weekendly overview cards sometimes omit a time; default to late-evening club start.
    const hours = timeMatch ? Number(timeMatch[1]) : 22;
    const minutes = timeMatch ? Number(timeMatch[2]) : 0;

    if (/heute/i.test(normalized)) {
      const d = new Date(now);
      d.setHours(hours, minutes, 0, 0);
      return d.toISOString();
    }

    if (/morgen/i.test(normalized)) {
      const d = new Date(now);
      d.setDate(d.getDate() + 1);
      d.setHours(hours, minutes, 0, 0);
      return d.toISOString();
    }

    // 1. Handle "DD.MM.YYYY" or "DD.MM.YY" (common in CH)
    const dotRegex = /(\d{1,2})\.(\d{1,2})\.(\d{2,4})/;
    const dotMatch = normalized.match(dotRegex);
    if (dotMatch) {
      const day = dotMatch[1].padStart(2, "0");
      const month = dotMatch[2].padStart(2, "0");
      let year = dotMatch[3];
      if (year.length === 2) year = `20${year}`;
      const isoDate = new Date(
        Date.UTC(Number(year), Number(month) - 1, Number(day), hours, minutes),
      );
      return isoDate.toISOString();
    }

    // 2. Handle "DD APRIL" style (Supermarket)
    const monthMap: { [key: string]: string } = {
      JANUAR: "01",
      JANUARY: "01",
      JAN: "01",
      FEBRUAR: "02",
      FEBRUARY: "02",
      FEB: "02",
      MÄRZ: "03",
      MARCH: "03",
      MAR: "03",
      APRIL: "04",
      APR: "04",
      MAI: "05",
      MAY: "05",
      JUNI: "06",
      JUNE: "06",
      JUN: "06",
      JULI: "07",
      JULY: "07",
      JUL: "07",
      AUGUST: "08",
      AUG: "08",
      SEPTEMBER: "09",
      SEP: "09",
      OKTOBER: "10",
      OCTOBER: "10",
      OCT: "10",
      NOVEMBER: "11",
      NOV: "11",
      DEZEMBER: "12",
      DECEMBER: "12",
      DEC: "12",
    };

    const textMonthRegex = new RegExp(
      `${GERMAN_DAY_PATTERN}?[.,\\s]*(\\d{1,2})\\.?\\s*([A-ZÄÖÜ]+)`,
      "i",
    );
    const textMonthMatch = normalized.match(textMonthRegex);
    if (textMonthMatch) {
      const day = textMonthMatch[1].padStart(2, "0");
      const monthName = textMonthMatch[2].toUpperCase();
      const month = monthMap[monthName];
      if (month) {
        const year = new Date().getFullYear();
        const isoDate = new Date(
          Date.UTC(year, Number(month) - 1, Number(day), hours, minutes),
        );
        return isoDate.toISOString();
      }
    }

    // Fallback to standard JS Date
    const d = new Date(normalized);
    if (!isNaN(d.getTime())) return d.toISOString();
  } catch (e) {
    console.warn(`Failed to parse date: ${dateStr}`, e);
  }

  return new Date().toISOString();
}

function safeTrim(text: string | undefined | null): string {
  return (text || "").replace(/\s+/g, " ").trim();
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
    if (!obj || typeof obj !== "object") continue;
    const record = obj as Record<string, unknown>;
    const type = record["@type"];
    if (typeof type === "string" && type.toLowerCase().includes("event"))
      return record;
    if (
      Array.isArray(type) &&
      type.some(
        (t) => typeof t === "string" && t.toLowerCase().includes("event"),
      )
    )
      return record;
    // Sometimes it's nested under @graph
    const graph = record["@graph"];
    if (Array.isArray(graph)) {
      const nested = findEventJsonLd(graph);
      if (nested) return nested;
    }
  }
  return null;
}

function normalizeGenres(genres: unknown): string[] {
  if (!genres) return [];
  if (Array.isArray(genres))
    return uniqStrings(genres.map((g) => (typeof g === "string" ? g : null)));
  if (typeof genres === "string") {
    return uniqStrings(genres.split(/[,/|·•]+/g).map((s) => s.trim()));
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
  if (lower === "genrepickx") return false;
  if (
    ["instagram", "facebook", "tiktok", "youtube", "soundcloud"].includes(lower)
  )
    return false;
  const stop = [
    "januar",
    "februar",
    "märz",
    "maerz",
    "april",
    "mai",
    "juni",
    "july",
    "juli",
    "august",
    "september",
    "oktober",
    "november",
    "dezember",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday",
    "montag",
    "dienstag",
    "mittwoch",
    "donnerstag",
    "freitag",
    "samstag",
    "sonntag",
  ];
  if (stop.includes(lower)) return false;
  if (/pres\.|present|set\b|live\b|doors?\b|start\b/i.test(s)) return false;
  const words = lower.split(/\s+/g).filter(Boolean);
  if (words.length > 3) return false;
  return true;
}

function extractArtistsFromJsonLd(event: Record<string, unknown>): string[] {
  const performer = event["performer"] ?? event["performers"];
  const collectName = (p: unknown): string | null => {
    if (!p) return null;
    if (typeof p === "string") return p;
    if (typeof p === "object") {
      const name = (p as Record<string, unknown>)["name"];
      if (typeof name === "string") return name;
    }
    return null;
  };
  if (Array.isArray(performer)) return uniqStrings(performer.map(collectName));
  return uniqStrings([collectName(performer)]);
}

function extractTicketUrlFromJsonLd(
  event: Record<string, unknown>,
): string | undefined {
  const offers = event["offers"];
  const extract = (o: unknown): string | undefined => {
    if (!o) return undefined;
    if (typeof o === "string") return o;
    if (typeof o === "object") {
      const url = (o as Record<string, unknown>)["url"];
      if (typeof url === "string") return url;
    }
    return undefined;
  };
  if (Array.isArray(offers)) return extract(offers[0]);
  return extract(offers);
}

function extractTimesFromText(text: string): {
  doorsTime?: string;
  startTime?: string;
} {
  const doors = text.match(
    /doors?\s*(?:open)?\s*[:\-]?\s*(\d{1,2}:\d{2})/i,
  )?.[1];
  const start = text.match(/start\s*[:\-]?\s*(\d{1,2}:\d{2})/i)?.[1];
  return {
    doorsTime: doors,
    startTime: start,
  };
}

function extractFallbackGenres($: cheerio.CheerioAPI): string[] {
  const fromTags = $('a[rel="tag"], a[href*="/tag/"], a[href*="genre"]')
    .toArray()
    .map((el) => $(el).text());
  const fromLabeled = $('[class*="genre"], [class*="tag"]')
    .toArray()
    .map((el) => $(el).text());
  return uniqStrings(
    [...fromTags, ...fromLabeled]
      .flatMap((t) => safeTrim(t).split(/[,/|·•]+/g))
      .map((s) => s.trim())
      .filter(Boolean)
      .filter(isPlausibleGenre),
  );
}

function extractTicketUrlFromDom(
  $: cheerio.CheerioAPI,
  baseUrl: string,
): string | undefined {
  const candidates = $("a[href]")
    .toArray()
    .map((el) => {
      const a = $(el);
      const href = a.attr("href") || "";
      const text = safeTrim(a.text()).toLowerCase();
      return { href, text };
    })
    .filter((c) => c.href && !c.href.startsWith("#"))
    .filter(
      (c) =>
        c.href.toLowerCase().includes("ticket") ||
        c.text.includes("ticket") ||
        c.text.includes("tickets") ||
        c.text.includes("vorverkauf"),
    );

  const first = candidates[0]?.href;
  return first ? makeAbsolute(first, baseUrl) : undefined;
}

function mergeDetailIntoEvent(
  event: CalendarEvent,
  detail: CachedEventDetail,
): CalendarEvent {
  const cleanedGenres = (detail.genres || []).filter(isPlausibleGenre);
  return {
    ...event,
    date: detail.date || event.date,
    genres: cleanedGenres.length > 0 ? cleanedGenres : event.genres,
    description: detail.description || event.description,
    artists:
      detail.artists && detail.artists.length > 0
        ? detail.artists
        : event.artists,
    ticketUrl: detail.ticketUrl || event.ticketUrl,
    imageUrl: detail.imageUrl || event.imageUrl,
    doorsTime: detail.doorsTime || event.doorsTime,
    startTime: detail.startTime || event.startTime,
  };
}

function kvAvailable(): boolean {
  return Boolean(
    process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN,
  );
}

function extractSectionTextAfterHeading(
  $: cheerio.CheerioAPI,
  headingRegex: RegExp,
): string | undefined {
  const heading = $("h1,h2,h3,h4,strong")
    .toArray()
    .map((el) => $(el))
    .find((h) => headingRegex.test(safeTrim(h.text())));
  if (!heading) return undefined;

  const container = heading.closest("section, article, div");
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
      .filter((s) => s.length <= 80),
  );
}

function parseDetailByClub(
  club: ClubName,
  $: cheerio.CheerioAPI,
  eventUrl: string,
): Partial<CachedEventDetail> {
  if (club === "Exil") {
    const imageRelative =
      $('meta[property="og:image"]').attr("content") ||
      $(".img-top.img-square").attr("src");
    const imageUrl = imageRelative
      ? makeAbsolute(imageRelative, eventUrl)
      : undefined;

    const description =
      safeTrim(
        $(
          ".event-description, .event__content, .event__text, .content, article",
        )
          .first()
          .text(),
      ) || undefined;

    const lineupText = extractSectionTextAfterHeading($, /line\s*up|artists?/i);
    const artists = parseArtistsFromText(lineupText);

    const ticketUrl =
      extractTicketUrlFromDom($, eventUrl) ||
      $('a[href*="ticket"]').first().attr("href") ||
      undefined;

    const genres = uniqStrings(
      $('.event-genre, .genres, [class*="genre"], [class*="tag"]')
        .toArray()
        .map((el) => $(el).text())
        .flatMap((t) => safeTrim(t).split(/[,/|·•]+/g)),
    ).filter(isPlausibleGenre);

    return {
      imageUrl,
      description,
      artists: artists.length > 0 ? artists : undefined,
      ticketUrl: ticketUrl ? makeAbsolute(ticketUrl, eventUrl) : undefined,
      genres: genres.length > 0 ? genres : undefined,
    };
  }

  if (club === "Mäx") {
    const description =
      safeTrim($('meta[property="og:description"]').attr("content")) ||
      safeTrim($(".prose, article, main").first().text()) ||
      undefined;

    const genres = uniqStrings(
      $('a[rel="tag"], [class*="tag"], [class*="badge"]')
        .toArray()
        .map((el) => $(el).text())
        .flatMap((t) => safeTrim(t).split(/[,/|·•]+/g)),
    ).filter(isPlausibleGenre);

    const artists = parseArtistsFromText(
      extractSectionTextAfterHeading($, /line\s*up|artists?|djs?/i),
    );

    return {
      description,
      genres: genres.length > 0 ? genres : undefined,
      artists: artists.length > 0 ? artists : undefined,
    };
  }

  if (club === "Supermarket") {
    const content = $(
      ".elementor-widget-theme-post-content, .elementor-widget-container, article",
    ).first();
    const description = content.length
      ? safeTrim(content.text()) || undefined
      : undefined;

    const artists = parseArtistsFromText(
      extractSectionTextAfterHeading($, /line\s*up|artists?|djs?/i),
    );

    const ticketUrl =
      extractTicketUrlFromDom($, eventUrl) ||
      $('a[href*="ticket"]').first().attr("href") ||
      undefined;

    return {
      description,
      artists: artists.length > 0 ? artists : undefined,
      ticketUrl: ticketUrl ? makeAbsolute(ticketUrl, eventUrl) : undefined,
    };
  }

  return {};
}

async function enrichEventFromDetail(
  event: CalendarEvent,
): Promise<CalendarEvent> {
  if (!event.eventUrl) return event;

  const cacheTtlSeconds = Number(
    process.env.SCRAPE_DETAIL_CACHE_TTL_SECONDS || 60 * 60 * 12,
  );
  if (kvAvailable()) {
    const cached = await getCachedEventDetail(event.eventUrl);
    if (cached) return mergeDetailIntoEvent(event, cached);
  }

  const $detail = await fetchAndParseWithRetry(event.eventUrl, {
    timeoutMs: Number(process.env.SCRAPE_DETAIL_TIMEOUT_MS || 12000),
    retries: Number(process.env.SCRAPE_DETAIL_RETRIES || 2),
    retryDelayBaseMs: Number(
      process.env.SCRAPE_DETAIL_RETRY_DELAY_BASE_MS || 400,
    ),
  });
  if (!$detail) return event;

  const jsonLdObjects = parseJsonLdObjects($detail);
  const jsonLdEvent = findEventJsonLd(jsonLdObjects);

  const ogImage = $detail('meta[property="og:image"]').attr("content");
  const ogDescription = $detail('meta[property="og:description"]').attr(
    "content",
  );
  const metaDescription = $detail('meta[name="description"]').attr("content");

  const description = safeTrim(
    (typeof jsonLdEvent?.description === "string"
      ? (jsonLdEvent.description as string)
      : undefined) ||
      ogDescription ||
      metaDescription,
  );

  const ticketUrl =
    (jsonLdEvent ? extractTicketUrlFromJsonLd(jsonLdEvent) : undefined) ||
    extractTicketUrlFromDom($detail, event.eventUrl) ||
    undefined;

  const genres = (jsonLdEvent ? normalizeGenres(jsonLdEvent.genre) : []) || [];

  const artists = jsonLdEvent ? extractArtistsFromJsonLd(jsonLdEvent) : [];

  const dateFromJsonLd =
    typeof jsonLdEvent?.startDate === "string"
      ? (jsonLdEvent.startDate as string)
      : undefined;
  const normalizedDate = dateFromJsonLd
    ? new Date(dateFromJsonLd).toISOString()
    : undefined;

  const bodyText = safeTrim($detail("body").text());
  const { doorsTime, startTime } = extractTimesFromText(bodyText);

  const cleanedJsonLdGenres = genres.filter(isPlausibleGenre);
  const fallbackGenres =
    cleanedJsonLdGenres.length > 0
      ? cleanedJsonLdGenres
      : extractFallbackGenres($detail);
  const imageUrl = ogImage
    ? makeAbsolute(ogImage, event.eventUrl)
    : event.imageUrl;

  const clubDetail = parseDetailByClub(event.club, $detail, event.eventUrl);

  const detail: CachedEventDetail = {
    fetchedAt: new Date().toISOString(),
    genres:
      clubDetail.genres && clubDetail.genres.length > 0
        ? clubDetail.genres
        : fallbackGenres,
    description: clubDetail.description || description || undefined,
    artists:
      clubDetail.artists && clubDetail.artists.length > 0
        ? clubDetail.artists
        : artists.length > 0
          ? artists
          : undefined,
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

async function asyncPool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length) as R[];
  let idx = 0;

  const runners = new Array(Math.min(concurrency, items.length))
    .fill(0)
    .map(async () => {
      while (true) {
        const current = idx++;
        if (current >= items.length) return;
        results[current] = await worker(items[current]);
      }
    });

  await Promise.all(runners);
  return results;
}

function normalizeForMatch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function detectClubFromText(value: string): ClubName | null {
  if (/\bmäx\b|\bmaex\b/i.test(value)) return "Mäx";

  const normalized = normalizeForMatch(value);
  if (!normalized) return null;
  if (normalized.includes("exil")) return "Exil";
  if (normalized.includes("supermarket")) return "Supermarket";
  if (normalized.includes("plaza")) return "Plaza";
  if (normalized.includes("xtra")) return "X-Tra";
  if (normalized.includes("bellevue")) return "Bellevue Club";
  return null;
}

function fallbackWeekendlyHostPath(club: ClubName): string {
  switch (club) {
    case "Exil":
      return "/host/exil-club";
    case "Mäx":
      return "/host/maex";
    case "Supermarket":
      return "/host/supermarket";
    case "Plaza":
      return "/host/plaza";
    case "X-Tra":
      return "/host/x-tra";
    case "Bellevue Club":
      return "/host/bellevue-club";
    default:
      return `/host/${normalizeForMatch(club)}`;
  }
}

async function resolveWeekendlyHostPath(club: ClubName): Promise<string> {
  const fallback = fallbackWeekendlyHostPath(club);
  const $ = await fetchAndParse(WEEKENDLY_ZURICH_CLUBS_URL);
  if (!$) return fallback;

  let foundPath: string | null = null;
  $('a[href^="/host/"]').each((_, el) => {
    if (foundPath) return;
    const href = safeTrim($(el).attr("href"));
    if (!href) return;

    const container = $(el).closest("article,li,div,section");
    const text = safeTrim(`${$(el).text()} ${container.text()} ${href}`);
    const matchedClub = detectClubFromText(text);
    if (matchedClub === club) {
      foundPath = href;
      return;
    }

    if (detectClubFromText(href) === club) {
      foundPath = href;
    }
  });

  return foundPath || fallback;
}

function pickWeekendlyTitle(
  $: cheerio.CheerioAPI,
  container: cheerio.Cheerio<Element>,
): string {
  const heading = safeTrim(
    container.find("h1,h2,h3,h4,[class*='title']").first().text(),
  );
  if (heading) return heading;

  const textLines = container
    .text()
    .split(/\n+/g)
    .map((line) => safeTrim(line))
    .filter(Boolean)
    .filter((line) => !/gewinne tickets?/i.test(line))
    .filter(
      (line) => !WEEKENDLY_DATE_LINE_REGEX.test(line),
    )
    .filter((line) => !/zürich|zurich/i.test(line))
    .filter((line) => !/\b\d{1,2}:\d{2}\b/.test(line))
    .filter((line) => line.length >= 3 && line.length <= 120);

  return textLines[0] || "";
}

function pickWeekendlyDateText(containerText: string): string | undefined {
  const normalized = safeTrim(containerText);
  if (!normalized) return undefined;
  const dateLike =
    normalized.match(
      new RegExp(
        `${GERMAN_RELATIVE_DAY_PATTERN}\\s*(?:ab\\s*)?\\d{1,2}:\\d{2}\\s*uhr?`,
        "i",
      ),
    )?.[0] ||
    normalized.match(
      new RegExp(
        `${GERMAN_DAY_PATTERN}\\.?,?\\s*\\d{1,2}\\.?\\s*[a-zäöü]+(?:\\s*ab\\s*\\d{1,2}:\\d{2}\\s*uhr?)?`,
        "i",
      ),
    )?.[0] ||
    normalized.match(
      /\d{1,2}\.?\s*[a-zäöü]+(?:\s*\d{4})?(?:\s*ab\s*\d{1,2}:\d{2}\s*uhr?)?/i,
    )?.[0];

  return dateLike ? safeTrim(dateLike) : undefined;
}

function pickWeekendlyGenres(
  $: cheerio.CheerioAPI,
  container: cheerio.Cheerio<Element>,
  club: ClubName,
): string[] {
  const candidates = uniqStrings(
    container
      .find("span,a,div,p,li")
      .toArray()
      .map((el) => safeTrim($(el).text()))
      .filter((t) => t.length >= 2 && t.length <= 20),
  ).filter((value) => {
    const lower = value.toLowerCase();
    if (lower.includes("ticket")) return false;
    if (lower.includes("zürich") || lower.includes("zurich")) return false;
    if (normalizeForMatch(value) === normalizeForMatch(club)) return false;
    if (/\b\d+(?:\.\d+)?\s*chf\b/i.test(value)) return false;
    return isPlausibleGenre(value);
  });

  return candidates.slice(0, 5);
}

async function scrapeWeekendlyClub(club: ClubName): Promise<CalendarEvent[]> {
  const hostPath = await resolveWeekendlyHostPath(club);
  const hostUrl = makeAbsolute(hostPath, WEEKENDLY_BASE_URL);
  const $ = await fetchAndParse(hostUrl);
  if (!$) return [];

  const events: CalendarEvent[] = [];
  const seen = new Set<string>();

  $('a[href*="/event/"]').each((_, el) => {
    const anchor = $(el);
    const href = safeTrim(anchor.attr("href"));
    if (!href) return;
    const eventUrl = makeAbsolute(href, WEEKENDLY_BASE_URL);
    if (seen.has(eventUrl)) return;
    seen.add(eventUrl);

    const container = anchor.closest("article,li,[class*='card'],div");
    const imageUrl = extractImageUrlFromContainer(
      $,
      container as cheerio.Cheerio<Element>,
      WEEKENDLY_BASE_URL,
    );
    const title = pickWeekendlyTitle($, container as cheerio.Cheerio<Element>);
    if (!title) return;

    const containerText = safeTrim(container.text());
    const dateText = pickWeekendlyDateText(containerText) || "";
    const genres = pickWeekendlyGenres($, container as cheerio.Cheerio<Element>, club);
    const location = pickWeekendlyLocation(containerText, club);

    events.push({
      id: generateId(),
      club,
      title,
      date: parseDate(dateText),
      eventUrl,
      imageUrl,
      genres,
      location,
    });
  });

  console.log(`${club}: Scraped ${events.length} events from Weekendly`);
  return events;
}

function pickWeekendlyLocation(
  containerText: string,
  club: ClubName,
): string | undefined {
  const normalized = containerText.toLowerCase();
  if (normalized.includes("zürich") || normalized.includes("zurich")) {
    return "Zürich";
  }
  if (detectClubFromText(containerText) === club) {
    return "Zürich";
  }
  return undefined;
}

function isWeekendlyDetailEnabled(): boolean {
  const explicit = process.env.SCRAPE_WEEKENDLY_DETAIL_ENABLED;
  if (explicit === "true") return true;
  if (explicit === "false") return false;
  // Backward compatibility with older flag.
  return process.env.SCRAPE_WEEKENDLY_SKIP_DETAIL === "false";
}

// Scraper for Exil
export async function scrapeExil(): Promise<CalendarEvent[]> {
  return scrapeWeekendlyClub("Exil");
}

// Scraper for Mäx
export async function scrapeMaex(): Promise<CalendarEvent[]> {
  return scrapeWeekendlyClub("Mäx");
}

// Scraper for Supermarket
export async function scrapeSupermarket(): Promise<CalendarEvent[]> {
  return scrapeWeekendlyClub("Supermarket");
}

// Scraper for Plaza
export async function scrapePlaza(): Promise<CalendarEvent[]> {
  return scrapeWeekendlyClub("Plaza");
}

// Scraper for X-Tra
export async function scrapeXTra(): Promise<CalendarEvent[]> {
  return scrapeWeekendlyClub("X-Tra");
}

// Scraper for Bellevue Club
export async function scrapeBellevueClub(): Promise<CalendarEvent[]> {
  return scrapeWeekendlyClub("Bellevue Club");
}

/**
 * Main scraper runner that aggregates all clubs
 */
export async function runAllScrapers(): Promise<CalendarEvent[]> {
  const scrapers = [
    { name: "Exil", fn: scrapeExil },
    { name: "Mäx", fn: scrapeMaex },
    { name: "Supermarket", fn: scrapeSupermarket },
    { name: "Plaza", fn: scrapePlaza },
    { name: "X-Tra", fn: scrapeXTra },
    { name: "Bellevue Club", fn: scrapeBellevueClub },
  ];

  const results = await Promise.all(
    scrapers.map(async (scraper) => {
      try {
        return await scraper.fn();
      } catch (error) {
        console.error(`Error in scraper ${scraper.name}:`, error);
        return [];
      }
    }),
  );

  const discovered = results.flat();

  const weekendlyDetailEnabled = isWeekendlyDetailEnabled();
  if (!weekendlyDetailEnabled) {
    return discovered;
  }

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
