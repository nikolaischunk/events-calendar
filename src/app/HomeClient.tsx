'use client';

import React, { useState } from 'react';
import styles from './page.module.css';
import { FilterBar } from '../components/organisms/FilterBar/FilterBar';
import { CalendarView } from '../components/organisms/CalendarView/CalendarView';
import { useRouter } from 'next/navigation';
import { ListView } from '../components/organisms/ListView/ListView';
import { CalendarEvent, ClubName } from '../lib/types';

interface HomeClientProps {
  events: CalendarEvent[];
  view: 'list' | 'calendar';
}

export function HomeClient({ events, view }: HomeClientProps) {
  const [selectedClubs, setSelectedClubs] = useState<string[]>([]);
  const [isUpdating, setIsUpdating] = useState(false);
  const router = useRouter();
  
  const availableClubs: ClubName[] = ["Mäx", "Exil", "Supermarket", "Plaza", "Club04", "X-Tra", "Bellevue Club"];

  const toggleClub = (club: string) => {
    setSelectedClubs(prev => 
      prev.includes(club) 
        ? prev.filter(c => c !== club)
        : [...prev, club]
    );
  };

  const filteredEvents = events.filter(event => {
    const passClub = selectedClubs.length === 0 || selectedClubs.includes(event.club);
    return passClub;
  });
  
  const handleUpdateData = async () => {
    setIsUpdating(true);
    try {
      const response = await fetch('/api/scrape');
      if (response.ok) {
        router.refresh();
      } else {
        console.error('Failed to update data:', await response.text());
      }
    } catch (error) {
      console.error('Error updating data:', error);
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <main className={styles.main}>
      <div className={styles.container}>
        <FilterBar 
          view={view}
          selectedClubs={selectedClubs}
          toggleClub={toggleClub}
          availableClubs={availableClubs}
          onUpdateData={handleUpdateData}
          isUpdating={isUpdating}
        />
        
        <div className={styles.contentArea}>
          {view === 'calendar' ? (
            <CalendarView events={filteredEvents} />
          ) : (
            <ListView events={filteredEvents} />
          )}
        </div>
      </div>
    </main>
  );
}
