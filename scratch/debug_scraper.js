import { runAllScrapers } from '../src/lib/scraper.js';
import { saveEvents } from '../src/lib/kv.js';

async function test() {
  console.log('Starting scraper...');
  try {
    const events = await runAllScrapers();
    console.log(`Scraped ${events.length} events.`);

    try {
      await saveEvents(events);
      console.log('Successfully saved to KV.');
    } catch (kvError) {
      console.error('KV Error:', kvError);
    }
  } catch (error) {
    console.error('Scraper Error:', error);
  }
}

test();
