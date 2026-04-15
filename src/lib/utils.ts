import { ClubName } from "./types";

export function getClubColorVariable(club: ClubName | string): string {
  switch (club) {
    case "Mäx":
      return "var(--club-maex)";
    case "Exil":
      return "var(--club-exil)";
    case "Supermarket":
      return "var(--club-supermarket)";
    case "Plaza":
      return "var(--club-plaza)";
    case "X-Tra":
      return "var(--club-xtra)";
    case "Bellevue Club":
      return "var(--club-bellevue)";
    default:
      return "var(--club-default)";
  }
}
