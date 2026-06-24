/**
 * Timezone detection utility for FA2I Platform.
 *
 * Detects the user's timezone from Intl.DateTimeFormat when available,
 * falling back to 'UTC' when detection is not possible.
 *
 * Satisfies Requirement 11.3/11.4: display times in the detected zone,
 * with UTC as the fallback when detection fails.
 */

/**
 * Detect the user's IANA timezone identifier.
 *
 * @returns {string} IANA timezone (e.g. 'Asia/Kolkata') or 'UTC' if detection fails
 */
export function detectTimezone() {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz && typeof tz === 'string' && tz.length > 0) {
      return tz;
    }
  } catch {
    // Intl not available or resolvedOptions failed
  }
  return 'UTC';
}

/**
 * Format an ISO instant string for display in the detected (or provided) timezone.
 *
 * @param {string} isoInstant - ISO 8601 date-time string (e.g. '2025-03-15T14:00:00Z')
 * @param {string} [timezone] - IANA timezone override; defaults to auto-detected
 * @returns {{ text: string, zoneLabel: string }} formatted time and its zone label
 */
export function formatDisplayTime(isoInstant, timezone) {
  const tz = timezone || detectTimezone();
  const date = new Date(isoInstant);

  const text = date.toLocaleString('fr-FR', {
    timeZone: tz,
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  return {
    text,
    zoneLabel: tz,
  };
}
/**
 * Compute the offset (in ms) of a given IANA timezone at a specific instant.
 * offset = (wall-clock time in tz) - (UTC time), positive for zones ahead of UTC.
 */
function tzOffsetMs(date, timeZone) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const parts = dtf.formatToParts(date);
  const map = {};
  for (const p of parts) map[p.type] = p.value;
  const asTZ = Date.UTC(
    Number(map.year), Number(map.month) - 1, Number(map.day),
    Number(map.hour), Number(map.minute), Number(map.second)
  );
  return asTZ - date.getTime();
}

/**
 * Convert a naive wall-clock datetime-local string (e.g. "2025-07-01T14:30")
 * interpreted in the given IANA timezone into an absolute UTC ISO string.
 *
 * @param {string} wall - datetime-local value "YYYY-MM-DDTHH:mm"
 * @param {string} timeZone - IANA timezone the wall time is expressed in
 * @returns {string} ISO 8601 UTC instant
 */
export function zonedWallTimeToUTCISO(wall, timeZone) {
  // Interpret the wall string as if it were UTC first
  const asUTC = new Date(wall.length === 16 ? wall + ':00Z' : wall + 'Z');
  // Find the zone's offset at that approximate instant and subtract it
  const offset = tzOffsetMs(asUTC, timeZone);
  return new Date(asUTC.getTime() - offset).toISOString();
}

/**
 * Convert an absolute UTC ISO instant into a naive wall-clock datetime-local
 * string ("YYYY-MM-DDTHH:mm") as seen in the given IANA timezone. This is the
 * inverse of {@link zonedWallTimeToUTCISO} and is suitable for prefilling
 * <input type="datetime-local"> values.
 *
 * @param {string} isoInstant - ISO 8601 UTC instant (e.g. '2025-07-01T12:30:00Z')
 * @param {string} timeZone - IANA timezone to express the wall time in
 * @returns {string} datetime-local value "YYYY-MM-DDTHH:mm" (empty string if invalid)
 */
export function utcISOToZonedWallTime(isoInstant, timeZone) {
  if (!isoInstant) return '';
  const date = new Date(isoInstant);
  if (Number.isNaN(date.getTime())) return '';
  const tz = timeZone || detectTimezone();
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
  const map = {};
  for (const p of dtf.formatToParts(date)) map[p.type] = p.value;
  return `${map.year}-${map.month}-${map.day}T${map.hour}:${map.minute}`;
}

/**
 * A curated list of common IANA timezones for the FA2I federation context,
 * always including the user's detected zone at the top.
 */
export function commonTimezones() {
  const detected = detectTimezone();
  const base = [
    'Asia/Kolkata',
    'Africa/Abidjan',
    'Europe/Paris',
    'Europe/London',
    'America/New_York',
    'America/Toronto',
    'UTC',
  ];
  const list = [detected, ...base.filter((z) => z !== detected)];
  return list;
}
