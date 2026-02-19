import type { OperationalPoint } from '../../shared/planning-types';
import type {
  OpRef,
  RouteDraft,
  RouteSegment,
  RouteStop,
  TimingPoint,
} from '../../core/models/timetable-draft.model';

export const DEFAULT_SPEED_KPH = 80;
export const DEFAULT_DWELL_SECONDS = 120;

export const nowIso = (): string => new Date().toISOString();

export const createDraftId = (prefix: string): string => {
  const seed =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${seed}`;
};

export const opToRef = (op: OperationalPoint): OpRef => ({
  id: op.uniqueOpId,
  name: op.name,
  lat: op.position?.lat,
  lon: op.position?.lng,
});

export const formatOpLabel = (op: OperationalPoint): string =>
  `${op.name} · ${op.uniqueOpId} (${op.countryCode})`;

export const toIsoWithTime = (dateIso: string, timeValue: string): string =>
  `${dateIso}T${timeValue}:00`;

export const parseIsoToUtcMs = (iso: string): number => {
  if (!iso) {
    return Number.NaN;
  }
  const [date, time] = iso.split('T');
  if (!date || !time) {
    return Number.NaN;
  }
  const [year, month, day] = date.split('-').map((part) => Number(part));
  const [hour, minute] = time.split(':').map((part) => Number(part));
  if (![year, month, day, hour, minute].every((value) => Number.isFinite(value))) {
    return Number.NaN;
  }
  return Date.UTC(year, month - 1, day, hour, minute, 0);
};

export const formatUtcMsToIso = (ms: number): string => {
  const date = new Date(ms);
  const pad = (value: number) => value.toString().padStart(2, '0');
  const yyyy = date.getUTCFullYear();
  const mm = pad(date.getUTCMonth() + 1);
  const dd = pad(date.getUTCDate());
  const hh = pad(date.getUTCHours());
  const min = pad(date.getUTCMinutes());
  return `${yyyy}-${mm}-${dd}T${hh}:${min}:00`;
};

export const formatIsoTime = (iso?: string): string => {
  if (!iso) {
    return '';
  }
  const time = iso.split('T')[1] ?? '';
  return time.slice(0, 5);
};

export const addMinutesToIso = (iso: string | undefined, minutes: number): string | undefined => {
  if (!iso) {
    return undefined;
  }
  const ms = parseIsoToUtcMs(iso);
  if (!Number.isFinite(ms)) {
    return iso;
  }
  return formatUtcMsToIso(ms + minutes * 60_000);
};

export const addSecondsToIso = (iso: string | undefined, seconds: number): string | undefined => {
  if (!iso) {
    return undefined;
  }
  const ms = parseIsoToUtcMs(iso);
  if (!Number.isFinite(ms)) {
    return iso;
  }
  return formatUtcMsToIso(ms + seconds * 1000);
};

export const haversineMeters = (
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number => {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const earthRadius = 6371e3;
  return earthRadius * c;
};

export const buildSegments = (
  stops: RouteStop[],
  assumptions: RouteDraft['assumptions'],
  previousSegments: RouteSegment[] = [],
): RouteSegment[] => {
  const prevById = new Map(previousSegments.map((segment) => [segment.segmentId, segment]));
  const segments: RouteSegment[] = [];
  for (let index = 0; index < stops.length - 1; index += 1) {
    const from = stops[index];
    const to = stops[index + 1];
    const segmentId = `${from.stopId}__${to.stopId}`;
    const prev = prevById.get(segmentId);
    const fromLat = from.op?.lat;
    const fromLon = from.op?.lon;
    const toLat = to.op?.lat;
    const toLon = to.op?.lon;
    const hasCoords =
      Number.isFinite(fromLat) &&
      Number.isFinite(fromLon) &&
      Number.isFinite(toLat) &&
      Number.isFinite(toLon);
    const distanceMeters = hasCoords
      ? haversineMeters(fromLat as number, fromLon as number, toLat as number, toLon as number)
      : 0;
    const assumedSpeedKph = prev?.assumedSpeedKph;
    const speed = assumedSpeedKph ?? assumptions.defaultSpeedKph;
    const travelSeconds = speed > 0 ? Math.round(distanceMeters / (speed * (1000 / 3600))) : 0;
    const geometry = hasCoords ? [[fromLat as number, fromLon as number], [toLat as number, toLon as number]] : [];
    segments.push({
      segmentId,
      fromStopId: from.stopId,
      toStopId: to.stopId,
      distanceMeters,
      assumedSpeedKph,
      estimatedTravelSeconds: travelSeconds,
      geometry,
    });
  }
  return segments;
};

export const buildTimingPointsFromRoute = (
  routeDraft: RouteDraft,
  startTimeIso: string,
): TimingPoint[] => {
  const points: TimingPoint[] = [];
  if (!startTimeIso) {
    return points;
  }
  const resolveSegmentDistance = (segment: RouteSegment | undefined): number => {
    if (!segment) {
      return 0;
    }
    if (segment.distanceMeters && segment.distanceMeters > 0) {
      return segment.distanceMeters;
    }
    const path = routeDraft.segmentOpPaths?.[segment.segmentId] ?? [];
    const pathKm = path.reduce((sum, entry) => sum + (entry.lengthKm ?? 0), 0);
    if (pathKm > 0) {
      return pathKm * 1000;
    }
    return segment.distanceMeters ?? 0;
  };
  let cursorIso = startTimeIso;
  routeDraft.stops.forEach((stop, index) => {
    if (index === 0) {
      points.push({ stopId: stop.stopId, departureIso: cursorIso });
      return;
    }
    const segment = routeDraft.segments[index - 1];
    let travelSeconds = segment?.estimatedTravelSeconds ?? 0;
    if ((!travelSeconds || travelSeconds <= 0) && segment) {
      const speed = segment.assumedSpeedKph ?? routeDraft.assumptions.defaultSpeedKph;
      if (speed > 0) {
        const distanceMeters = resolveSegmentDistance(segment);
        travelSeconds = Math.round(distanceMeters / (speed * (1000 / 3600)));
      }
    }
    cursorIso = addSecondsToIso(cursorIso, travelSeconds) ?? cursorIso;
    const arrivalIso = cursorIso;
    if (stop.kind === 'destination' || stop.kind === 'pass') {
      points.push({ stopId: stop.stopId, arrivalIso });
      return;
    }
    const dwellSeconds = stop.dwellSeconds ?? routeDraft.assumptions.defaultDwellSeconds;
    const departureIso = addSecondsToIso(arrivalIso, dwellSeconds) ?? arrivalIso;
    cursorIso = departureIso;
    points.push({ stopId: stop.stopId, arrivalIso, departureIso });
  });
  return points;
};

export const buildCumulativeDistances = (routeDraft: RouteDraft): Map<string, number> => {
  const cumulative = new Map<string, number>();
  let distance = 0;
  if (!routeDraft.stops.length) {
    return cumulative;
  }
  cumulative.set(routeDraft.stops[0].stopId, 0);
  routeDraft.segments.forEach((segment) => {
    distance += segment.distanceMeters ?? 0;
    cumulative.set(segment.toStopId, distance);
  });
  return cumulative;
};

export type PassThroughPoint = {
  stopId: string;
  opId: string;
  op?: OpRef;
  arrivalIso?: string;
  departureIso?: string;
  distanceMeters: number;
};

export const buildPassThroughPoints = (
  routeDraft: RouteDraft,
  startPoints: TimingPoint[],
): PassThroughPoint[] => {
  const passPoints: PassThroughPoint[] = [];
  const pointMap = new Map(startPoints.map((point) => [point.stopId, point] as const));
  const opLookup = new Map((routeDraft.routeOps ?? []).map((op) => [op.id, op]));
  const stopOpIds = new Set(routeDraft.stops.map((stop) => stop.op?.id).filter(Boolean));
  const segmentIds = routeDraft.segments.map((segment) => segment.segmentId);
  const segmentPaths = routeDraft.segmentOpPaths ?? {};
  const hasAllSegmentPaths =
    segmentIds.length > 0 &&
    segmentIds.every((id) => (segmentPaths[id] ?? []).length > 0);
  if (!hasAllSegmentPaths && routeDraft.routeOps?.length) {
    const originStop = routeDraft.stops.find((stop) => stop.kind === 'origin');
    const destinationStop = routeDraft.stops.find((stop) => stop.kind === 'destination');
    const originPoint = originStop ? pointMap.get(originStop.stopId) : startPoints[0];
    const destinationPoint = destinationStop
      ? pointMap.get(destinationStop.stopId)
      : startPoints[startPoints.length - 1];
    const startIso = originPoint?.departureIso ?? originPoint?.arrivalIso;
    const endIso = destinationPoint?.arrivalIso ?? destinationPoint?.departureIso;
    const routeOps = routeDraft.routeOps ?? [];
    let totalSeconds = 0;
    if (startIso && endIso) {
      totalSeconds = (parseIsoToUtcMs(endIso) - parseIsoToUtcMs(startIso)) / 1000;
    }
    let cumulativeDistance = 0;
    let totalDistance = 0;
    const distances = routeOps.map((op, index) => {
      if (index === 0) {
        return 0;
      }
      const prev = routeOps[index - 1];
      if (
        Number.isFinite(prev.lat) &&
        Number.isFinite(prev.lon) &&
        Number.isFinite(op.lat) &&
        Number.isFinite(op.lon)
      ) {
        return haversineMeters(prev.lat as number, prev.lon as number, op.lat as number, op.lon as number);
      }
      return 1000;
    });
    totalDistance = distances.reduce((sum, value) => sum + value, 0);
    if (totalSeconds <= 0 && totalDistance > 0 && startIso) {
      const speed = routeDraft.assumptions.defaultSpeedKph;
      if (speed > 0) {
        totalSeconds = Math.round(totalDistance / (speed * (1000 / 3600)));
      }
    }
    for (let index = 0; index < routeOps.length; index += 1) {
      const op = routeOps[index];
      if (index > 0) {
        cumulativeDistance += distances[index] ?? 0;
      }
      if (!op?.id || stopOpIds.has(op.id)) {
        continue;
      }
      const ratio =
        totalDistance > 0
          ? cumulativeDistance / totalDistance
          : index / Math.max(1, routeOps.length - 1);
      const arrivalIso =
        startIso && totalSeconds > 0
          ? addSecondsToIso(startIso, Math.round(totalSeconds * ratio))
          : undefined;
      passPoints.push({
        stopId: `pass-${op.id}`,
        opId: op.id,
        op: opLookup.get(op.id) ?? op,
        arrivalIso,
        departureIso: arrivalIso,
        distanceMeters: cumulativeDistance,
      });
    }
    return passPoints;
  }
  const seenOpIds = new Set<string>();
  let cumulativeDistance = 0;
  routeDraft.segments.forEach((segment) => {
    const path = routeDraft.segmentOpPaths?.[segment.segmentId] ?? [];
    const segmentDistanceMeters =
      segment.distanceMeters && segment.distanceMeters > 0
        ? segment.distanceMeters
        : 0;
    if (!path.length) {
      cumulativeDistance += segmentDistanceMeters;
      return;
    }
    const rawLengths = path.map((entry) =>
      entry.lengthKm && entry.lengthKm > 0 ? entry.lengthKm * 1000 : 0,
    );
    const totalRaw = rawLengths.reduce((sum, value) => sum + value, 0);
    const fallbackLength = segmentDistanceMeters && path.length
      ? segmentDistanceMeters / path.length
      : 0;
    const scale =
      totalRaw > 0 && segmentDistanceMeters > 0
        ? segmentDistanceMeters / totalRaw
        : 1;
    const opSeq: Array<{ id: string; dist: number }> = [];
    let cursor = 0;
    path.forEach((entry, index) => {
      const startId = entry.startUniqueOpId;
      const endId = entry.endUniqueOpId;
      if (startId && (!opSeq.length || opSeq[opSeq.length - 1].id !== startId)) {
        opSeq.push({ id: startId, dist: cursor });
      }
      const length = rawLengths[index] > 0 ? rawLengths[index] * scale : fallbackLength;
      cursor += length;
      if (endId && (!opSeq.length || opSeq[opSeq.length - 1].id !== endId)) {
        opSeq.push({ id: endId, dist: cursor });
      }
    });
    const fromPoint = pointMap.get(segment.fromStopId);
    const toPoint = pointMap.get(segment.toStopId);
    const startIso = fromPoint?.departureIso ?? fromPoint?.arrivalIso;
    const endIso = toPoint?.arrivalIso ?? toPoint?.departureIso;
    let totalSeconds = 0;
    let effectiveStart = startIso;
    let effectiveEnd = endIso;
    if (startIso && endIso) {
      totalSeconds =
        (parseIsoToUtcMs(endIso) - parseIsoToUtcMs(startIso)) / 1000;
    } else if (startIso && segment.estimatedTravelSeconds) {
      totalSeconds = segment.estimatedTravelSeconds;
      effectiveEnd = addSecondsToIso(startIso, totalSeconds);
    }
    if (effectiveStart && totalSeconds <= 0) {
      const fallbackDistance =
        segmentDistanceMeters && segmentDistanceMeters > 0 ? segmentDistanceMeters : cursor;
      const fallbackSpeed =
        segment.assumedSpeedKph ?? routeDraft.assumptions.defaultSpeedKph;
      if (fallbackDistance > 0 && fallbackSpeed > 0) {
        totalSeconds = Math.round(
          fallbackDistance / (fallbackSpeed * (1000 / 3600)),
        );
        effectiveEnd = addSecondsToIso(effectiveStart, totalSeconds);
      }
    }
    const segmentTotal = cursor > 0 ? cursor : segmentDistanceMeters;
    opSeq.forEach((entry) => {
      if (!entry.id || stopOpIds.has(entry.id)) {
        return;
      }
      if (seenOpIds.has(entry.id)) {
        return;
      }
      seenOpIds.add(entry.id);
      let arrivalIso: string | undefined;
      if (effectiveStart && totalSeconds > 0 && segmentTotal > 0) {
        const ratio = entry.dist / segmentTotal;
        const offsetSeconds = Math.round(totalSeconds * ratio);
        arrivalIso = addSecondsToIso(effectiveStart, offsetSeconds);
      }
      passPoints.push({
        stopId: `pass-${entry.id}`,
        opId: entry.id,
        op: opLookup.get(entry.id),
        arrivalIso,
        departureIso: arrivalIso,
        distanceMeters: cumulativeDistance + entry.dist,
      });
    });
    cumulativeDistance += segmentTotal;
  });
  return passPoints;
};
