import { CalendarEvent } from "./types";

const today = new Date();
const tomorrow = new Date(today);
tomorrow.setDate(tomorrow.getDate() + 1);
const nextWeek = new Date(today);
nextWeek.setDate(nextWeek.getDate() + 7);

export const mockEvents: CalendarEvent[] = [
  {
    id: "1",
    club: "Mäx",
    title: "Techno Tuesday",
    description: "Experience the dark and moody vibes of Mäx with lasers piercing through the fog. The best local techno DJs spinning all night long.",
    date: today.toISOString(),
    imageUrl: "/images/techno.png",
    genres: ["Techno", "House"],
  },
  {
    id: "2",
    club: "Exil",
    title: "Indie Pop Night",
    description: "A vibrant 2000s pop club party with colorful disco lights and an energetic crowd dancing to neon vibes.",
    date: tomorrow.toISOString(),
    imageUrl: "/images/pop.png",
    genres: ["Pop", "Indie"],
  },
  {
    id: "3",
    club: "Supermarket",
    title: "Deep House Session",
    description: "Dive deep into rhythmic electronic beats at one of Zurich's most iconic underground clubs.",
    date: tomorrow.toISOString(),
    imageUrl: "/images/techno.png",
    genres: ["Deep House", "Electronic"],
  },
  {
    id: "4",
    club: "X-Tra",
    title: "2000s Throwback",
    description: "All the hits you remember from the early 2000s. Bring your nostalgia and best dance moves.",
    date: nextWeek.toISOString(),
    imageUrl: "/images/pop.png",
    genres: ["2000s", "Pop", "Hits"],
  },
  {
    id: "5",
    club: "Bellevue Club",
    title: "RnB Vibes",
    description: "Smooth R&B and HipHop tunes right in the heart of Bellevue.",
    date: nextWeek.toISOString(),
    imageUrl: "/images/pop.png",
    genres: ["RnB", "HipHop"],
  },
  {
    id: "6",
    club: "Plaza",
    title: "Disco Fever",
    description: "Studio 54 vibes with a modern twist. Disco beats all night.",
    date: today.toISOString(),
    imageUrl: "/images/pop.png",
    genres: ["Disco", "House"],
  }
];

