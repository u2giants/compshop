import exifr from "exifr";

export interface ExifData {
  latitude: number | null;
  longitude: number | null;
  dateTime: string | null; // ISO date string YYYY-MM-DD
}

export async function extractExif(file: File): Promise<ExifData> {
  try {
    const exif = await exifr.parse(file, {
      gps: true,
      pick: ["DateTimeOriginal", "CreateDate", "GPSLatitude", "GPSLongitude"],
    });

    if (!exif) return { latitude: null, longitude: null, dateTime: null };

    const lat = exif.latitude ?? null;
    const lng = exif.longitude ?? null;

    let dateTime: string | null = null;
    const rawDate = exif.DateTimeOriginal || exif.CreateDate;
    if (rawDate instanceof Date) {
      dateTime = rawDate.toISOString().split("T")[0];
    } else if (typeof rawDate === "string") {
      // EXIF date format: "YYYY:MM:DD HH:MM:SS"
      const cleaned = rawDate.replace(/^(\d{4}):(\d{2}):(\d{2})/, "$1-$2-$3");
      const parsed = new Date(cleaned);
      if (!isNaN(parsed.getTime())) {
        dateTime = parsed.toISOString().split("T")[0];
      }
    }

    return { latitude: lat, longitude: lng, dateTime };
  } catch {
    return { latitude: null, longitude: null, dateTime: null };
  }
}

// Haversine distance in km
export function distanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
