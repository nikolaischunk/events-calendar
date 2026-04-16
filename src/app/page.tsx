import { getEvents } from '../lib/kv';
import { HomeClient } from './HomeClient';

// Ensure this page is rendered dynamically when events update, or revalidated periodically.
export const revalidate = 60; // revalidate every 60 seconds

export default async function Home() {
  const events = await getEvents();
  
  return <HomeClient events={events} view="calendar" />;
}
