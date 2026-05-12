'use client';

import { useRouter } from 'next/navigation';
import styles from './BackButton.module.css';

interface BackButtonProps {
  className?: string;
}

export const BackButton: React.FC<BackButtonProps> = ({ className }) => {
  const router = useRouter();
  return (
    <button onClick={() => router.back()} className={`${styles.backBtn}${className ? ` ${className}` : ''}`}>
      &larr; Back
    </button>
  );
};
