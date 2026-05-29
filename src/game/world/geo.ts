import { WORLD_MAP_COLUMNS, WORLD_MAP_ROWS } from '../../constants';
import type { Position } from '../../types';

/*
  Approximate conversion between Earth coordinates (latitude/longitude) and the
  game's world-tile coordinates.

  The world map is a roughly equirectangular projection. These constants were
  calibrated by linear-fitting a handful of known ports (Lisbon, Istanbul,
  Nagasaki, …) against their real-world positions. The fit is approximate
  (error ~5-15 tiles), which is fine for a debug "go to roughly here" teleport.

  - Longitude maps linearly to x and wraps around (the world is seamless E-W).
    2160 tiles / 360° = 6 tiles per degree.
  - Latitude maps linearly to y, with y increasing southward.
*/

const PX_PER_LNG = WORLD_MAP_COLUMNS / 360; // 6
const LNG_ORIGIN_X = 895; // x tile where longitude = 0°

const PX_PER_LAT = 7.06; // calibrated; the map doesn't span the full poles
const LAT_ORIGIN_Y = 631; // y tile where latitude = 0° (equator)

const wrapX = (x: number) => ((x % WORLD_MAP_COLUMNS) + WORLD_MAP_COLUMNS) % WORLD_MAP_COLUMNS;

export const latLngToWorld = (lat: number, lng: number): Position => ({
  x: Math.round(wrapX(LNG_ORIGIN_X + lng * PX_PER_LNG)),
  y: Math.round(
    Math.min(WORLD_MAP_ROWS - 1, Math.max(0, LAT_ORIGIN_Y - lat * PX_PER_LAT)),
  ),
});

export const worldToLatLng = ({ x, y }: Position): { lat: number; lng: number } => {
  let lng = (x - LNG_ORIGIN_X) / PX_PER_LNG;
  lng = ((((lng + 180) % 360) + 360) % 360) - 180;

  return {
    lat: (LAT_ORIGIN_Y - y) / PX_PER_LAT,
    lng,
  };
};
