// Swipe-up-to-unlock, as the phone page feels it. Pure, so it is unit tested.

/** progress (fraction of the screen height) past which letting go unlocks */
export const UNLOCK_FRACTION = 0.14;
/** or a quick flick: screens per second */
export const FLICK_SPEED = 0.9;
/** iOS Safari owns the bottom edge (home-bar swipe): a swipe may not start there */
export const BOTTOM_EDGE = 0.15;

export const clamp01 = (n: number): number => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);

/** May a touch that began at clientY (of a screen h tall) start a swipe? */
export const inSwipeZone = (clientY: number, h: number): boolean => h > 0 && clientY <= h * (1 - BOTTOM_EDGE);

/** upward travel dy (negative = up, px) as 0..1 of the screen height */
export const dragProgress = (dy: number, h: number): number => (h > 0 ? clamp01(-dy / h) : 0);

/** Does letting go at progress p, having moved at `speed` screens/s, unlock? */
export const shouldUnlock = (p: number, speed: number): boolean => p > UNLOCK_FRACTION || (p > 0.04 && speed > FLICK_SPEED);
