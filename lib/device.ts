/**
 * Phone detection from the User-Agent, decided server-side so the right
 * layout renders on the first byte (no client-side flash or CLS).
 *
 * Deliberate segmentation: PHONES get the dedicated mobile landing;
 * tablets (iPad et al.) keep the desktop/isometric design, which is built
 * for desktop, laptop and iPad viewports.
 *
 * Note: iPadOS 13+ reports a Macintosh UA, which lands it on the desktop
 * design — exactly the segmentation we want.
 */
export function isPhoneUserAgent(userAgent: string | null | undefined): boolean {
  if (!userAgent) return false;

  // Android tablets have "Android" WITHOUT "Mobile"; phones include both.
  if (/Android/i.test(userAgent)) return /Mobile/i.test(userAgent);

  return /iPhone|iPod|Windows Phone|BlackBerry|Opera Mini|Mobi/i.test(userAgent);
}
