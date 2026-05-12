import { getEvents } from '../../lib/kv';
import { HomeClient } from '../HomeClient';

export const dynamic = 'force-dynamic';

export default async function ListPage() {
  const events = await getEvents();
  return <HomeClient events={events} view="list" />;
}

