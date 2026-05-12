import React, { useState } from 'react';
import Link from 'next/link';
import styles from './CalendarView.module.css';
import { CalendarEvent } from '../../../lib/types';
import { getClubColorVariable } from '../../../lib/utils';
import { Card } from '../../atoms/Card/Card';

interface CalendarViewProps {
  events: CalendarEvent[];
}

export const CalendarView: React.FC<CalendarViewProps> = ({ events }) => {
  const [currentDate, setCurrentDate] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });

  const nextMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));
  };
  const prevMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
  };

  const monthName = currentDate.toLocaleDateString('de-CH', { month: 'long', year: 'numeric' });

  // Calendar logic
  const daysInMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0).getDate();
  const startDayOfWeek = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1).getDay(); // 0 = Sun
  
  // Adjust so Monday is 0, Sun is 6
  const adjustedStartDay = startDayOfWeek === 0 ? 6 : startDayOfWeek - 1;

  const days = [];
  for (let i = 0; i < adjustedStartDay; i++) {
    days.push(null);
  }
  for (let i = 1; i <= daysInMonth; i++) {
    days.push(i);
  }

  return (
    <div className={styles.calendarContainer}>
      <div className={styles.header}>
        <button onClick={prevMonth} className={styles.navBtn}>&larr;</button>
        <h2 className={styles.monthTitle}>{monthName}</h2>
        <button onClick={nextMonth} className={styles.navBtn}>&rarr;</button>
      </div>

      <Card className={styles.gridCard}>
        <div className={styles.grid}>
          {['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map(day => (
            <div key={day} className={styles.dayOfWeek}>{day}</div>
          ))}
          
          {days.map((day, idx) => {
            if (!day) return <div key={idx} className={styles.emptyDay} />;
            
            // Find events for this day — compare ISO date prefix to avoid UTC→local shift
            const year = currentDate.getFullYear();
            const month = String(currentDate.getMonth() + 1).padStart(2, '0');
            const dayStr = String(day).padStart(2, '0');
            const targetDateStr = `${year}-${month}-${dayStr}`;
            const dayEvents = events.filter(e => e.date.startsWith(targetDateStr));

            return (
              <div key={idx} className={styles.dayCell}>
                <span className={styles.dayNumber}>{day}</span>
                <div className={styles.eventsContainer}>
                  {dayEvents.map(event => (
                    <Link key={event.id} href={`/event/${event.id}`}>
                      <div 
                        className={styles.eventChip} 
                        style={{ backgroundColor: getClubColorVariable(event.club) }}
                        title={`${event.club} - ${event.title}`}
                      >
                        <span className={styles.eventChipClub}>{event.club}:</span> {event.title}
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
};
