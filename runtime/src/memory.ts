/** Shared linear memory layout for the browser wasm profile. */
export const MEMORY_INITIAL_PAGES = 1;
export const MEMORY_MAX_PAGES = 1;

export const MAX_BLOCKS = 64;
export const MAX_PINS = 8;
export const MAX_INTERVALS = 32;

export const OFFSET_WRITE_COUNT = 0;
export const OFFSET_CLOSED = 4;
export const OFFSET_HAS_PIN = 16;
export const OFFSET_LAST_PIN = OFFSET_HAS_PIN + MAX_BLOCKS * MAX_PINS;
export const OFFSET_INTERVAL_PERIODS = OFFSET_LAST_PIN + MAX_BLOCKS * MAX_PINS * 4;
