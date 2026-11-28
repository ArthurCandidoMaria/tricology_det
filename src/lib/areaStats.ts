import type { SessionPhoto, SessionWithPhotos } from './types';
import { SCALP_AREAS, areaLabel } from './constants';
import { formatDate } from './formatters';

export { areaLabel };

/** Uma sessão, vista pela ótica de uma única área do couro cabeludo. */
export interface AreaSessionPoint {
  sessionId: string;
  date: string;
  label: string;
  /** Média de bulbos detectados das fotos desta área nesta sessão. */
  avg: number;
  min: number;
  max: number;
  countedPhotos: number;
  /** Média de fios detectados na segmentação grayscale nesta área. */
  avgStrands: number | null;
  /** Espessura média dos fios (px) nesta área. */
  avgThicknessPx: number | null;
  photos: SessionPhoto[];
}

export interface AreaPhotoRef {
  photo: SessionPhoto;
  date: string;
  label: string;
}

/** Evolução de uma área ao longo de todas as sessões do paciente. */
export interface AreaSummary {
  area: string;
  label: string;
  points: AreaSessionPoint[];
  photos: AreaPhotoRef[];
  latest: number | null;
  first: number | null;
  delta: number | null;
  deltaPct: number | null;
  latestStrands: number | null;
  latestThicknessPx: number | null;
  hasComparison: boolean;
  sessionCount: number;
  photoCount: number;
}

const AREA_ORDER = new Map<string, number>(SCALP_AREAS.map((a, i) => [a.value as string, i]));

function meanOrNull(nums: Array<number | null | undefined>, decimals = 1): number | null {
  const valid = nums.filter((n): n is number => n != null && !Number.isNaN(n));
  if (valid.length === 0) return null;
  const avg = valid.reduce((a, b) => a + b, 0) / valid.length;
  const factor = 10 ** decimals;
  return Math.round(avg * factor) / factor;
}

export function buildAreaSummaries(sessions: SessionWithPhotos[]): AreaSummary[] {
  const ordered = [...sessions].sort((a, b) => a.session_date.localeCompare(b.session_date));
  const acc = new Map<string, { points: AreaSessionPoint[]; photos: AreaPhotoRef[]; sessionIds: Set<string> }>();

  for (const session of ordered) {
    const label = formatDate(session.session_date);
    const grouped = new Map<string, SessionPhoto[]>();

    for (const photo of session.session_photos) {
      const area = photo.scalp_area || 'unknown';
      if (!grouped.has(area)) grouped.set(area, []);
      grouped.get(area)!.push(photo);
    }

    for (const [area, photos] of grouped) {
      if (!acc.has(area)) acc.set(area, { points: [], photos: [], sessionIds: new Set() });
      const entry = acc.get(area)!;
      entry.sessionIds.add(session.id);

      for (const photo of photos) entry.photos.push({ photo, date: session.session_date, label });

      const counts = photos
        .map((p) => p.hair_count)
        .filter((n): n is number => n != null && !Number.isNaN(n));

      const avgStrands = meanOrNull(photos.map((p) => p.strand_count), 1);
      const avgThicknessPx = meanOrNull(photos.map((p) => p.avg_thickness_px), 2);

      if (counts.length > 0 || avgStrands != null) {
        const sum = counts.reduce((a, b) => a + b, 0);
        entry.points.push({
          sessionId: session.id,
          date: session.session_date,
          label,
          avg: counts.length > 0 ? Math.round(sum / counts.length) : 0,
          min: counts.length > 0 ? Math.min(...counts) : 0,
          max: counts.length > 0 ? Math.max(...counts) : 0,
          countedPhotos: counts.length,
          avgStrands,
          avgThicknessPx,
          photos,
        });
      }
    }
  }

  const summaries: AreaSummary[] = [];

  for (const [area, entry] of acc) {
    const points = entry.points;
    const latest = points.length > 0 ? points[points.length - 1].avg : null;
    const first = points.length > 0 ? points[0].avg : null;
    const hasComparison = points.length >= 2;
    const delta = hasComparison && latest != null && first != null ? latest - first : null;
    const deltaPct = hasComparison && first ? ((latest! - first) / first) * 100 : null;

    const latestWithStrands = [...points].reverse().find((p) => p.avgStrands != null);
    const latestWithThickness = [...points].reverse().find((p) => p.avgThicknessPx != null);

    summaries.push({
      area,
      label: areaLabel(area),
      points,
      photos: entry.photos,
      latest,
      first,
      delta,
      deltaPct,
      latestStrands: latestWithStrands?.avgStrands ?? null,
      latestThicknessPx: latestWithThickness?.avgThicknessPx ?? null,
      hasComparison,
      sessionCount: entry.sessionIds.size,
      photoCount: entry.photos.length,
    });
  }

  return summaries.sort((a, b) => {
    const oa = AREA_ORDER.get(a.area) ?? Number.MAX_SAFE_INTEGER;
    const ob = AREA_ORDER.get(b.area) ?? Number.MAX_SAFE_INTEGER;
    return oa - ob || a.label.localeCompare(b.label, 'pt-BR');
  });
}

export function spreadLabel(point: AreaSessionPoint): string | null {
  if (point.countedPhotos < 2 || point.min === point.max) return null;
  return `${point.min}–${point.max}`;
}
