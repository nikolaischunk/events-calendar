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
}

export function HomeClient({ events }: HomeClientProps) {
  const [view, setView] = useState<'list' | 'calendar'>('calendar');
  const [selectedClubs, setSelectedClubs] = useState<string[]>([]);
  const [selectedGenres, setSelectedGenres] = useState<string[]>([]);
  const [isUpdating, setIsUpdating] = useState(false);
  const router = useRouter();
  
  const availableClubs: ClubName[] = ["Mäx", "Exil", "Supermarket", "Plaza", "X-Tra", "Bellevue Club"];
  
  // Extract unique genres from events
  const availableGenres = Array.from(
    new Set(events.flatMap(event => event.genres || []))
  ).sort();

  const toggleClub = (club: string) => {
    setSelectedClubs(prev => 
      prev.includes(club) 
        ? prev.filter(c => c !== club)
        : [...prev, club]
    );
  };

  const toggleGenre = (genre: string) => {
    setSelectedGenres(prev => 
      prev.includes(genre)
        ? prev.filter(g => g !== genre)
        : [...prev, genre]
    );
  };

  const filteredEvents = events.filter(event => {
    const passClub = selectedClubs.length === 0 || selectedClubs.includes(event.club);
    const passGenre = selectedGenres.length === 0 || (event.genres && event.genres.some(g => selectedGenres.includes(g)));
    return passClub && passGenre;
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
          setView={setView}
          selectedClubs={selectedClubs}
          toggleClub={toggleClub}
          availableClubs={availableClubs}
          selectedGenres={selectedGenres}
          toggleGenre={toggleGenre}
          availableGenres={availableGenres}
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
