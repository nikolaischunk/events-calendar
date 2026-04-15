import React from 'react';
import styles from './Badge.module.css';

interface BadgeProps {
  label: string;
  color?: string; // Expects a CSS var or hex, e.g., var(--club-maex)
  variant?: 'solid' | 'outline' | 'subtle';
}

export const Badge: React.FC<BadgeProps> = ({ 
  label, 
  color = 'var(--text-secondary)', 
  variant = 'subtle' 
}) => {
  const inlineStyle: React.CSSProperties = {
    '--badge-color': color,
  } as React.CSSProperties;

  return (
    <span className={`${styles.badge} ${styles[variant]}`} style={inlineStyle}>
      {label}
    </span>
  );
};
