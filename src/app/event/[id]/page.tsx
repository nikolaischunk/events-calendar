import React from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { mockEvents } from '../../../lib/mockData';
import { getClubColorVariable } from '../../../lib/utils';
import { Badge } from '../../../components/atoms/Badge/Badge';
import { Card } from '../../../components/atoms/Card/Card';
import styles from './page.module.css';

// In Next.js 13+ App Router, Params for dynamic routes are promised or synchronous depending on version.
// Using standard setup for Next.js 16 (App Router sync/async params handling).
// We'll treat params as a Promise.
interface EventPageProps {
  params: Promise<{ id: string }>;
}

export default async function EventDetail({ params }: EventPageProps) {
  const resolvedParams = await params;
  const event = mockEvents.find(e => e.id === resolvedParams.id);

  if (!event) {
    return (
      <main className={styles.main}>
        <div className={styles.container}>
          <Link href="/" className={styles.backBtn}>&larr; Back to Calendar</Link>
          <div className={styles.notFound}>Event not found</div>
        </div>
      </main>
    );
  }

  const clubColor = getClubColorVariable(event.club);
  const eventDate = new Date(event.date);
  
  const dateString = eventDate.toLocaleDateString('de-CH', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });
  
  const timeString = eventDate.toLocaleTimeString('de-CH', { 
    hour: '2-digit', 
    minute: '2-digit' 
  });

  return (
    <main className={styles.main}>
      <div className={styles.container}>
        <Link href="/" className={styles.backBtn}>&larr; Back</Link>
        
        <Card className={styles.detailCard}>
          {event.imageUrl && (
            <div className={styles.heroImageWrapper}>
              <Image 
                src={event.imageUrl} 
                alt={event.title} 
                fill
                priority
                className={styles.heroImage}
              />
              <div 
                className={styles.heroGradient} 
                style={{ background: `linear-gradient(to top, var(--bg-card) 0%, transparent 100%)` }}
              />
            </div>
          )}
          
          <div className={styles.content}>
            <div className={styles.header}>
              <div className={styles.titleRow}>
                <h1 className={styles.title}>{event.title}</h1>
                <Badge label={event.club} color={clubColor} variant="solid" />
              </div>
              <div className={styles.metaRow}>
                <div className={styles.dateTime}>
                  <span className={styles.date}>{dateString}</span>
                  <span className={styles.time}>{timeString}</span>
                </div>
                <div className={styles.genres}>
                  {event.genres.map(genre => (
                    <Badge key={genre} label={genre} variant="subtle" />
                  ))}
                </div>
              </div>
            </div>

            {event.description && (
              <div className={styles.descriptionSection}>
                <h3 className={styles.sectionTitle}>About the Event</h3>
                <p className={styles.descriptionText}>{event.description}</p>
              </div>
            )}
            
            <div className={styles.actionSection}>
              <button 
                className={styles.primaryBtn}
                style={{ backgroundColor: clubColor }}
              >
                Get Tickets
              </button>
            </div>
          </div>
        </Card>
      </div>
    </main>
  );
}
