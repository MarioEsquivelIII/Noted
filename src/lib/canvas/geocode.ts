import type { AcademicLocation, LocationMode } from "./types";
import { detectLocationMode } from "./types";

// ─── Known campus locations (extracted from home/page.tsx for shared use) ───

export const GT_LOCATIONS: Record<string, { name: string; lat: number; lng: number }> = {
  ccb: { name: "CCB", lat: 33.7773, lng: -84.3963 },
  clough: { name: "Clough Commons", lat: 33.7773, lng: -84.3963 },
  kendeda: { name: "Kendeda", lat: 33.7783, lng: -84.3978 },
  scheller: { name: "Scheller", lat: 33.7766, lng: -84.3876 },
  coda: { name: "CODA", lat: 33.7748, lng: -84.3874 },
  klaus: { name: "Klaus", lat: 33.7772, lng: -84.3928 },
  coc: { name: "College of Computing", lat: 33.7774, lng: -84.3975 },
  "college of computing": { name: "College of Computing", lat: 33.7774, lng: -84.3975 },
  "student center": { name: "Student Center", lat: 33.7739, lng: -84.3986 },
  crc: { name: "CRC", lat: 33.7755, lng: -84.4035 },
  "campus recreation": { name: "CRC", lat: 33.7755, lng: -84.4035 },
  library: { name: "Price Gilbert Library", lat: 33.7741, lng: -84.3958 },
  "price gilbert": { name: "Price Gilbert Library", lat: 33.7741, lng: -84.3958 },
  "tech square": { name: "Tech Square", lat: 33.7766, lng: -84.3890 },
  "north ave": { name: "North Ave", lat: 33.7697, lng: -84.3906 },
  howey: { name: "Howey Physics", lat: 33.7775, lng: -84.3988 },
  "van leer": { name: "Van Leer", lat: 33.7760, lng: -84.3984 },
  skiles: { name: "Skiles", lat: 33.7735, lng: -84.3960 },
  "instructional center": { name: "Instructional Center", lat: 33.7757, lng: -84.4013 },
  "love building": { name: "Love Building", lat: 33.7760, lng: -84.3950 },
  "mason building": { name: "Mason Building", lat: 33.7765, lng: -84.3945 },
  "cherry emerson": { name: "Cherry Emerson", lat: 33.7780, lng: -84.3968 },
  "boggs building": { name: "Boggs Building", lat: 33.7778, lng: -84.3975 },
  "ford es&t": { name: "Ford ES&T Building", lat: 33.7780, lng: -84.3958 },
};

/** Resolve a location string against known campus locations */
export function resolveKnownLocation(
  locationStr: string,
): { name: string; lat: number; lng: number } | undefined {
  if (!locationStr) return undefined;
  const lower = locationStr.toLowerCase();

  // Exact match
  if (GT_LOCATIONS[lower]) return { ...GT_LOCATIONS[lower], name: locationStr };

  // Partial match
  for (const [key, loc] of Object.entries(GT_LOCATIONS)) {
    if (lower.includes(key) || key.includes(lower)) {
      return { ...loc, name: locationStr };
    }
  }

  return undefined;
}

/** Geocode a location string using Mapbox forward geocoding API */
async function geocodeWithMapbox(
  locationRaw: string,
  proximity = "-84.3963,33.7756", // GT campus center
): Promise<{
  placeName: string;
  formattedAddress: string;
  lat: number;
  lng: number;
  confidence: number;
  mapboxId?: string;
} | null> {
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  if (!token) return null;

  const encoded = encodeURIComponent(locationRaw);
  const url =
    `https://api.mapbox.com/geocoding/v5/mapbox.places/${encoded}.json` +
    `?proximity=${proximity}&limit=1&access_token=${token}`;

  try {
    const res = await fetch(url);
    if (!res.ok) return null;

    const data = await res.json();
    const feature = data.features?.[0];
    if (!feature) return null;

    return {
      placeName: feature.text || feature.place_name || locationRaw,
      formattedAddress: feature.place_name || "",
      lng: feature.center[0],
      lat: feature.center[1],
      confidence: feature.relevance ?? 0,
      mapboxId: feature.id,
    };
  } catch {
    return null;
  }
}

/** Full geocoding pipeline: known locations first, then Mapbox fallback */
export async function geocodeLocation(
  locationRaw: string,
  descriptionText?: string,
): Promise<AcademicLocation> {
  const locationMode: LocationMode = detectLocationMode(
    descriptionText || locationRaw,
  );

  // If detected as remote, skip geocoding
  if (locationMode === "remote") {
    return {
      rawText: locationRaw,
      locationMode: "remote",
      requiresReview: false,
    };
  }

  // Try known campus locations first
  const known = resolveKnownLocation(locationRaw);
  if (known) {
    return {
      rawText: locationRaw,
      locationMode: "in_person",
      mapboxPlaceName: known.name,
      latitude: known.lat,
      longitude: known.lng,
      geocodeConfidence: 1.0,
      requiresReview: false,
    };
  }

  // Fallback to Mapbox geocoding
  const mapbox = await geocodeWithMapbox(locationRaw);
  if (mapbox) {
    const requiresReview = mapbox.confidence < 0.7;
    return {
      rawText: locationRaw,
      locationMode: locationMode === "unknown" ? "in_person" : locationMode,
      mapboxPlaceName: mapbox.placeName,
      formattedAddress: mapbox.formattedAddress,
      latitude: mapbox.lat,
      longitude: mapbox.lng,
      geocodeConfidence: mapbox.confidence,
      mapboxId: mapbox.mapboxId,
      requiresReview,
    };
  }

  // No geocoding result — store raw text only
  return {
    rawText: locationRaw,
    locationMode,
    requiresReview: false,
  };
}
