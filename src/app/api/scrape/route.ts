import { NextResponse } from 'next/server';
import { runAllScrapers } from '@/lib/scraper';
import { saveEvents } from '@/lib/kv';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const secret = searchParams.get('secret');

  // Verify the secret to prevent unauthorized scraping
  // In production, you would check this against process.env.SCRAPE_SECRET
  // For local development, we allow a bypass or a specific string like "local_dev"
  if (process.env.NODE_ENV === 'production' && secret !== process.env.SCRAPE_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const events = await runAllScrapers();
    
    // Attempt to save them to Vercel KV if it's configured
    try {
      await saveEvents(events);
      console.log(`Successfully saved ${events.length} events to KV.`);
    } catch (kvError: unknown) {
      console.error('KV Save Error - Is UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN set?', kvError);
      // We still return the events even if KV fails to save for visibility
    }

    return NextResponse.json({ 
      success: true, 
      count: events.length,
      events 
    });
  } catch (error: unknown) {
    console.error('Scraping Error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
