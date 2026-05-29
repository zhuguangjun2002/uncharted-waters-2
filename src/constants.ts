export const START_DATE = new Date(1522, 4, 17);
export const START_TIME_PASSED = 480;

export const TILE_SIZE = 32;
export const WORLD_MAP_COLUMNS = 2160;
export const WORLD_MAP_ROWS = 1080;

// Debug-only features (e.g. teleport) are hidden from production builds.
export const DEBUG = process.env.NODE_ENV !== 'production';
