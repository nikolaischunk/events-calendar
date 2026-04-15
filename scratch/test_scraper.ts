import { scrapeExil, scrapeMaex, scrapeSupermarket } from './src/lib/scraper';

async function test() {
  console.log('--- Testing Exil ---');
  try {
    const exil = await scrapeExil();
    console.log(`Found ${exil.length} events`);
  } catch (e) {
    console.error('Exil Error:', e.message);
  }

  console.log('\n--- Testing Mäx ---');
  try {
    const maex = await scrapeMaex();
    console.log(`Found ${maex.length} events`);
  } catch (e) {
    console.error('Mäx Error:', e.message);
  }

  console.log('\n--- Testing Supermarket ---');
  try {
    const supermarket = await scrapeSupermarket();
    console.log(`Found ${supermarket.length} events`);
  } catch (e) {
    console.error('Supermarket Error:', e.message);
  }
}

test();
