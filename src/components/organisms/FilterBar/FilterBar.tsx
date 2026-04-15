import React from 'react';
import styles from './FilterBar.module.css';
import { ClubName } from '../../../lib/types';
import { Badge } from '../../atoms/Badge/Badge';
import { getClubColorVariable } from '../../../lib/utils';

interface FilterBarProps {
  view: 'list' | 'calendar';
  setView: (view: 'list' | 'calendar') => void;
  selectedClubs: string[];
  toggleClub: (club: string) => void;
  availableClubs: ClubName[];
  selectedGenres: string[];
  toggleGenre: (genre: string) => void;
  availableGenres: string[];
}

export const FilterBar: React.FC<FilterBarProps> = ({
  view,
  setView,
  selectedClubs,
  toggleClub,
  availableClubs,
  selectedGenres,
  toggleGenre,
  availableGenres
}) => {
  return (
    <div className={styles.filterBar}>
      <div className={styles.topRow}>
        <h1 className={styles.pageTitle}>Zurich Nightlife</h1>
        <div className={styles.viewToggle}>
          <button 
            className={`${styles.toggleBtn} ${view === 'calendar' ? styles.active : ''}`}
            onClick={() => setView('calendar')}
          >
            Calendar
          </button>
          <button 
            className={`${styles.toggleBtn} ${view === 'list' ? styles.active : ''}`}
            onClick={() => setView('list')}
          >
            List
          </button>
        </div>
      </div>
      
      <div className={styles.filtersWrapper}>
        <div className={styles.filterGroup}>
          <span className={styles.filterLabel}>Filter by Club:</span>
          <div className={styles.tagsContainer}>
            {availableClubs.map(club => {
              const isSelected = selectedClubs.includes(club);
              return (
                <button 
                  key={club} 
                  onClick={() => toggleClub(club)}
                  className={styles.filterBtn}
                >
                  <Badge 
                    label={club} 
                    color={getClubColorVariable(club)} 
                    variant={isSelected ? 'solid' : 'outline'} 
                  />
                </button>
              );
            })}
          </div>
        </div>

        <div className={styles.filterGroup}>
          <span className={styles.filterLabel}>Party Type:</span>
          <div className={styles.tagsContainer}>
            {availableGenres.map(genre => {
              const isSelected = selectedGenres.includes(genre);
              return (
                <button 
                  key={genre} 
                  onClick={() => toggleGenre(genre)}
                  className={styles.filterBtn}
                >
                  <Badge 
                    label={genre} 
                    color="var(--text-secondary)" 
                    variant={isSelected ? 'solid' : 'outline'} 
                  />
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
