import React from 'react';
import styles from './ListView.module.css';
import { CalendarEvent } from '../../../lib/types';
import { EventCard } from '../../molecules/EventCard/EventCard';

interface ListViewProps {
  events: CalendarEvent[];
}

export const ListView: React.FC<ListViewProps> = ({ events }) => {
  // Group events by date
  const groupedEvents = events.reduce((acc, event) => {
    const dateObj = new Date(event.date);
    // Use local date string as key, e.g., "Montag, 15. April"
    const dateKey = dateObj.toLocaleDateString('de-CH', {
      weekday: 'long',
      day: 'numeric',
      month: 'long'
    });

    if (!acc[dateKey]) {
      acc[dateKey] = [];
    }
    acc[dateKey].push(event);
    return acc;
  }, {} as Record<string, CalendarEvent[]>);

  // Sort dates (assuming the keys keep rough insertion order for now, 
  // but better to sort by actual date)
  const sortedDates = Object.keys(groupedEvents).sort((a, b) => {
    return new Date(groupedEvents[a][0].date).getTime() - new Date(groupedEvents[b][0].date).getTime();
  });

  if (events.length === 0) {
    return (
      <div className={styles.emptyState}>
        <p>No events found for the selected filters.</p>
      </div>
    );
  }

  return (
    <div className={styles.listView}>
      {sortedDates.map(dateKey => (
        <div key={dateKey} className={styles.dateGroup}>
          <h2 className={styles.dateHeader}>{dateKey}</h2>
          <div className={styles.eventsList}>
            {groupedEvents[dateKey]
              .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
              .map(event => (
              <EventCard key={event.id} event={event} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
};
