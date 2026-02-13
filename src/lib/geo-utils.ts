/**
 * Geographic region detection for upload geo-fencing.
 *
 * Rough bounding boxes:
 *   Asia:  lat 0–55, lng 60–150
 *   Americas (US/Canada/Mexico): lat 15–72, lng -170– -50
 */

export type GeoRegion = "asia" | "americas" | "other";

export function detectRegion(lat: number, lng: number): GeoRegion {
  // Asia (broad: covers East Asia, Southeast Asia, South Asia, Middle East edge)
  if (lat >= -10 && lat <= 55 && lng >= 60 && lng <= 155) return "asia";
  // Americas (US, Canada, Mexico, Central America)
  if (lat >= 15 && lat <= 72 && lng >= -170 && lng <= -50) return "americas";
  return "other";
}

/** Check if coordinates are in Asia */
export function isInAsia(lat: number, lng: number): boolean {
  return detectRegion(lat, lng) === "asia";
}

/** Check if coordinates are in the Americas */
export function isInAmericas(lat: number, lng: number): boolean {
  return detectRegion(lat, lng) === "americas";
}
