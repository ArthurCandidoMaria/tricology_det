import type { SessionPhoto, SessionWithPhotos } from './types';
import { SCALP_AREAS } from './constants';
import { formatDate } from './formatters';

/** Uma sessão, vista pela ótica de uma única área do couro cabeludo. */
export interface AreaSessionPoint {
  sessionId: string;
  date: string;
  label: string;
  /** Média das contagens das fotos desta área nesta sessão. */
  avg: number;
  min: number;
  max: number;
  /** Quantas fotos tinham contagem — base da média. */
  countedPhotos: number;
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
  /** Só há tendência a partir de dois pontos. Sem isso, nada de seta nem cor. */
  hasComparison: boolean;
  sessionCount: number;
  photoCount: number;
}

const AREA_LABELS = new Map<string, string>(SCALP_AREAS.map((a) => [a.value as string, a.label]));
const AREA_ORDER = new Map<string, number>(SCALP_AREAS.map((a, i) => [a.value as string, i]));

export function areaLabel(area: string): string {
  return AREA_LABELS.get(area) ?? area;
}

/**
 * Agrupa as fotos de todas as sessões por área, preservando a dispersão
 * (min/max) em vez de reduzir cada sessão a uma média isolada.
 * Áreas fora de SCALP_AREAS são mantidas no fim, para que nenhuma foto suma da tela.
 */
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

      if (counts.length > 0) {
        const sum = counts.reduce((a, b) => a + b, 0);
        entry.points.push({
          sessionId: session.id,
          date: session.session_date,
          label,
          avg: Math.round(sum / counts.length),
          min: Math.min(...counts),
          max: Math.max(...counts),
          countedPhotos: counts.length,
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

    summaries.push({
      area,
      label: areaLabel(area),
      points,
      photos: entry.photos,
      latest,
      first,
      delta,
      deltaPct,
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

/** Rótulo de dispersão das fotos de uma sessão: "9–16" quando há espalhamento. */
export function spreadLabel(point: AreaSessionPoint): string | null {
  if (point.countedPhotos < 2 || point.min === point.max) return null;
  return `${point.min}–${point.max}`;
}
