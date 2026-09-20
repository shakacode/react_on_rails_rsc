/**
 * React 19.3 Flight import metadata deduplicates strings of length >= 16
 * into `id:"value"` chunks and references them as `$<hex-id>` inside I-rows.
 * Resolve those references before comparing wire rows to manifest metadata.
 */

const BY_VALUE_REF = /^\$[0-9a-f]+$/i;

const flightStringTable = (payload: string): Map<string, unknown> => {
  const table = new Map<string, unknown>();
  for (const line of payload.split('\n')) {
    const match = /^([0-9a-f]+):(.*)$/.exec(line);
    if (!match) continue;
    const id = match[1];
    const rest = match[2];
    if (
      id &&
      rest &&
      (rest.startsWith('"') || rest === 'null' || rest === 'true' || rest === 'false')
    ) {
      table.set(id, JSON.parse(rest) as unknown);
    }
  }
  return table;
};

const resolveFlightValue = (
  value: unknown,
  table: Map<string, unknown>,
  seen: Set<string> = new Set()
): unknown => {
  if (typeof value === 'string' && BY_VALUE_REF.test(value)) {
    const id = value.slice(1).toLowerCase();
    if (seen.has(id) || !table.has(id)) return value;
    seen.add(id);
    return resolveFlightValue(table.get(id), table, seen);
  }
  if (Array.isArray(value)) {
    return value.map((item) => resolveFlightValue(item, table, seen));
  }
  return value;
};

/** Flight module-import rows look like `<hex row id>:I[id, chunks, name]`. */
export const importRows = (payload: string): [string, string[], string][] => {
  const table = flightStringTable(payload);
  return [...payload.matchAll(/^[0-9a-f]+:I(\[.*\])$/gm)].map((match) => {
    const raw = JSON.parse(match[1]!) as unknown;
    return resolveFlightValue(raw, table) as [string, string[], string];
  });
};

export const resolveFlightJson = <T>(payload: string, json: string): T => {
  const table = flightStringTable(payload);
  return resolveFlightValue(JSON.parse(json), table) as T;
};
