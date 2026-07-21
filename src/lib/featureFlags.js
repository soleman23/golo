/**
 * Build-time feature flags.
 *
 * These are plain constants, not runtime config: Vite folds them at build time,
 * so a disabled feature's UI is dropped from the bundle rather than merely
 * hidden. Flipping one requires a rebuild — which is the point.
 */

/**
 * GHIN (USGA GPA) handicap sync and score posting.
 *
 * Re-enable when GHIN edge functions are deployed AND USGA approval lands —
 * see docs/GHIN.md. All GHIN code, DB columns, and migrations stay in place.
 *
 * While this is false, the Handicap Index on You is entered by hand and is the
 * only handicap path; Setup seeds each round from it and writes it back.
 */
export const GHIN_ENABLED = false
