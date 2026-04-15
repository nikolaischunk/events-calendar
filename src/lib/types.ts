export type ClubName = "Mäx" | "Exil" | "Supermarket" | "Plaza" | "X-Tra" | "Bellevue Club";

export interface CalendarEvent {
  id: string;
  club: ClubName;
  title: string;
  description?: string;
  date: string; // ISO 8601 string
  imageUrl?: string;
  genres: string[];
}
