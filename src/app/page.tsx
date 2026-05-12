import { getEvents } from '../lib/kv';
import { HomeClient } from './HomeClient';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const events = await getEvents();
  
  return <HomeClient events={events} view="calendar" />;
}
