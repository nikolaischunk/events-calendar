import React from 'react';
import Link from 'next/link';
import styles from './FilterBar.module.css';
import { ClubName } from '../../../lib/types';
import { Badge } from '../../atoms/Badge/Badge';
import { getClubColorVariable } from '../../../lib/utils';

interface FilterBarProps {
  view: 'list' | 'calendar';
  selectedClubs: string[];
  toggleClub: (club: string) => void;
  availableClubs: ClubName[];
  onUpdateData: () => void;
  isUpdating: boolean;
}

export const FilterBar: React.FC<FilterBarProps> = ({
  view,
  selectedClubs,
  toggleClub,
  availableClubs,
  onUpdateData,
  isUpdating
}) => {
  return (
    <div className={styles.filterBar}>
      <div className={styles.topRow}>
        <h1 className={styles.pageTitle}>Zurich Nightlife</h1>
        <div className={styles.viewToggle}>
          <Link
            href="/"
            className={`${styles.toggleBtn} ${view === 'calendar' ? styles.active : ''}`}
          >
            Calendar
          </Link>
          <Link
            href="/list"
            className={`${styles.toggleBtn} ${view === 'list' ? styles.active : ''}`}
          >
            List
          </Link>
        </div>
        
        <button 
          className={`${styles.updateBtn} ${isUpdating ? styles.loading : ''}`}
          onClick={onUpdateData}
          disabled={isUpdating}
        >
          {isUpdating ? (
            <>
              <span className={styles.spinner}></span>
              Updating...
            </>
          ) : (
            'Update Data'
          )}
        </button>
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
      </div>
    </div>
  );
};
