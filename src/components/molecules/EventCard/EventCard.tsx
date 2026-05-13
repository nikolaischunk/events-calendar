import React from 'react';
import Image from 'next/image';
import Link from 'next/link';
import styles from './EventCard.module.css';
import { Card } from '../../atoms/Card/Card';
import { Badge } from '../../atoms/Badge/Badge';
import { CalendarEvent } from '../../../lib/types';
import { getClubColorVariable } from '../../../lib/utils';

interface EventCardProps {
  event: CalendarEvent;
}

export const EventCard: React.FC<EventCardProps> = ({ event }) => {
  const clubColor = getClubColorVariable(event.club);
  const eventDate = new Date(event.date);
  const displayTime =
    event.startTime ??
    eventDate.toLocaleTimeString("de-CH", {
      hour: "2-digit",
      minute: "2-digit",
    });

  return (
    <Link href={`/event/${event.id}`}>
      <Card hoverable className={styles.eventCard}>
        {event.imageUrl && (
          <div className={styles.imageWrapper}>
            <Image 
              src={event.imageUrl} 
              alt={event.title} 
              fill
              sizes="(max-width: 640px) 100vw, 140px"
              className={styles.image}
            />
          </div>
        )}
        <div className={styles.contentSection}>
          <div className={styles.header}>
            <h3 className={styles.title}>{event.title}</h3>
            <Badge label={event.club} color={clubColor} variant="solid" />
          </div>
          {event.description && (
            <p className={styles.description}>{event.description}</p>
          )}
        </div>

        {displayTime && (
          <div className={styles.timeSection}>
            <span className={styles.time}>{displayTime}</span>
          </div>
        )}
      </Card>
    </Link>
  );
};
