'use client';

import React, { useState } from 'react';
import styles from './page.module.css';
import { FilterBar } from '../components/organisms/FilterBar/FilterBar';
import { CalendarView } from '../components/organisms/CalendarView/CalendarView';
import { ListView } from '../components/organisms/ListView/ListView';
import { mockEvents } from '../lib/mockData';
import { ClubName } from '../lib/types';

export default function Home() {
  const [view, setView] = useState<'list' | 'calendar'>('calendar');
  const [selectedClubs, setSelectedClubs] = useState<string[]>([]);
  const [selectedGenres, setSelectedGenres] = useState<string[]>([]);
  
  const availableClubs: ClubName[] = ["Mäx", "Exil", "Supermarket", "Plaza", "X-Tra", "Bellevue Club"];
  
  // Extract unique genres from mock data
  const availableGenres = Array.from(
    new Set(mockEvents.flatMap(event => event.genres))
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

  // Filter events based on selected clubs AND selected genres
  const filteredEvents = mockEvents.filter(event => {
    const passClub = selectedClubs.length === 0 || selectedClubs.includes(event.club);
    const passGenre = selectedGenres.length === 0 || event.genres.some(g => selectedGenres.includes(g));
    return passClub && passGenre;
  });

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
