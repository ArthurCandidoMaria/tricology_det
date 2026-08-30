import { useEffect, useState } from 'react';
import { ArrowLeft, BarChart3, Loader2, TrendingUp, TrendingDown, Minus, X, ZoomIn } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import type { Patient, SessionWithPhotos } from '@/lib/types';
import { SCALP_AREAS } from '@/lib/constants';
import { formatDate, formatNumber } from '@/lib/formatters';
import type { ScalpArea } from '@/lib/types';

interface Props {
  patient: Patient;
  onBack: () => void;
}

interface ReviewPhoto {
  url: string;
  label: string;
  date: string;
  value: number | null;
}

interface AreaData {
  area: ScalpArea;
  label: string;
  values: { date: string; label: string; value: number }[];
  photos: ReviewPhoto[];
  latest: number | null;
  first: number | null;
  delta: number | null;
  deltaPct: number | null;
  photoCount: number;
}

export function AnalyzeByArea({ patient, onBack }: Props) {
  const [sessions, setSessions] = useState<SessionWithPhotos[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPhoto, setSelectedPhoto] = useState<{ url: string; label: string } | null>(null);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from('sessions')
        .select('*, session_photos(*)')
        .eq('patient_id', patient.id)
        .order('session_date', { ascending: true });

      setLoading(false);
      if (!error && data) setSessions(data as SessionWithPhotos[]);
    })();
  }, [patient.id]);

  const areaData: AreaData[] = (() => {
    const valuesMap = new Map<ScalpArea, { date: string; label: string; value: number }[]>();
    const photosMap = new Map<ScalpArea, ReviewPhoto[]>();

    for (const s of sessions) {
      const byArea = new Map<ScalpArea, number[]>();
      for (const photo of s.session_photos) {
        const area = photo.scalp_area as ScalpArea;

        if (photo.hair_count != null) {
          if (!byArea.has(area)) byArea.set(area, []);
          byArea.get(area)!.push(photo.hair_count);
        }

        const photoUrl = photo.annotated_photo_url || photo.photo_url;
        if (!photoUrl) continue;

        if (!photosMap.has(area)) photosMap.set(area, []);
        photosMap.get(area)!.push({
          url: photoUrl,
          label: formatDate(s.session_date),
          date: s.session_date,
          value: photo.hair_count,
        });
      }

      for (const [area, counts] of byArea) {
        const avg = Math.round(counts.reduce((a, b) => a + b, 0) / counts.length);
        if (!valuesMap.has(area)) valuesMap.set(area, []);
        valuesMap.get(area)!.push({ date: s.session_date, label: formatDate(s.session_date), value: avg });
      }
    }

    return SCALP_AREAS.map((a) => {
      const values = valuesMap.get(a.value) ?? [];
      const photos = photosMap.get(a.value) ?? [];
      const latest = values.length > 0 ? values[values.length - 1].value : null;
      const first = values.length > 0 ? values[0].value : null;
      const delta = latest != null && first != null ? latest - first : null;
      const deltaPct = first && latest ? ((latest - first) / first) * 100 : null;
      return {
        area: a.value,
        label: a.label,
        values,
        photos,
        latest,
        first,
        delta,
        deltaPct,
        photoCount: values.length > 0 ? values.length : photos.length,
      };
    }).filter((d) => d.photoCount > 0);
  })();

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 animate-slide-up">
      <button onClick={onBack} className="btn-ghost mb-6 -ml-2">
        <ArrowLeft size={18} /> Voltar ao painel
      </button>

      <div className="mb-6">
        <div className="flex items-center gap-3 mb-1">
          <div className="h-10 w-10 rounded-xl bg-accent-50 flex items-center justify-center">
            <BarChart3 size={22} className="text-accent-600" />
          </div>
          <h1 className="font-display text-2xl font-bold text-ink-900">Analisar por área</h1>
        </div>
        <p className="text-sm text-ink-500">Contagem de fios/folículos por área ao longo do tempo para {patient.name}.</p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20 text-ink-400">
          <Loader2 size={28} className="animate-spin" />
        </div>
      ) : areaData.length === 0 ? (
        <div className="card p-12 text-center">
          <p className="text-ink-500 font-medium">Nenhum dado por área disponível ainda.</p>
          <p className="text-sm text-ink-400 mt-1">Inicie uma nova sessão com fotos atribuídas a áreas do couro cabeludo para ver a análise aqui.</p>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 gap-4">
          {areaData.map((d) => (
            <AreaCard key={d.area} data={d} onPreview={setSelectedPhoto} />
          ))}
        </div>
      )}

      {selectedPhoto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setSelectedPhoto(null)}>
          <div className="relative max-w-5xl w-full max-h-[90vh] bg-white rounded-2xl shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              onClick={() => setSelectedPhoto(null)}
              className="absolute right-3 top-3 z-10 inline-flex h-10 w-10 items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/70"
              aria-label="Fechar visualização"
            >
              <X size={18} />
            </button>
            <img src={selectedPhoto.url} alt={selectedPhoto.label} className="max-h-[85vh] w-full object-contain bg-ink-950" />
            <div className="px-4 py-3 border-t border-ink-100 bg-white">
              <p className="text-sm font-semibold text-ink-700">Foto revisada</p>
              <p className="text-xs text-ink-400">{selectedPhoto.label}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function AreaCard({ data, onPreview }: { data: AreaData; onPreview: (photo: { url: string; label: string }) => void }) {
  const { delta, deltaPct, latest, values } = data;
  const trendIcon = delta == null ? <Minus size={16} /> : delta >= 0 ? <TrendingUp size={16} /> : <TrendingDown size={16} />;
  const trendColor = delta == null ? 'text-ink-400' : delta >= 0 ? 'text-brand-600' : 'text-red-500';

  const sparkW = 200;
  const sparkH = 50;
  const spark = (() => {
    if (values.length < 2) return null;
    const vals = values.map((v) => v.value);
    const lo = Math.min(...vals);
    const hi = Math.max(...vals);
    const range = hi - lo || 1;
    const pts = values.map((v, i) => {
      const x = (i / (values.length - 1)) * sparkW;
      const y = sparkH - ((v.value - lo) / range) * (sparkH - 8) - 4;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    return `M ${pts.join(' L ')}`;
  })();

  return (
    <div className="card p-5 hover:shadow-card transition-shadow">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="font-display font-bold text-ink-900">{data.label}</h3>
          <p className="text-xs text-ink-400 mt-0.5">{data.photoCount} ponto{data.photoCount > 1 ? 's' : ''} de dados</p>
        </div>
        <div className={`flex items-center gap-1 text-sm font-semibold ${trendColor}`}>
          {trendIcon}
          {delta != null && deltaPct != null ? `${delta >= 0 ? '+' : ''}${deltaPct.toFixed(1)}%` : '—'}
        </div>
      </div>

      <div className="flex items-end gap-3 mb-3">
        <div>
          <p className="text-xs text-ink-400">Mais recente</p>
          <p className="font-display text-xl font-bold text-ink-900">{latest != null ? formatNumber(latest) : '—'}</p>
        </div>
        {delta != null && (
          <div className="pb-0.5">
            <span className={`text-sm font-semibold ${trendColor}`}>
              {delta >= 0 ? '+' : ''}{formatNumber(delta)}
            </span>
          </div>
        )}
      </div>

      {spark ? (
        <svg viewBox={`0 0 ${sparkW} ${sparkH}`} className="w-full" style={{ height: sparkH }}>
          <path d={spark} fill="none" stroke="#22a163" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {values.map((v, i) => {
            const x = (i / (values.length - 1)) * sparkW;
            const lo = Math.min(...values.map((x) => x.value));
            const hi = Math.max(...values.map((x) => x.value));
            const range = hi - lo || 1;
            const y = sparkH - ((v.value - lo) / range) * (sparkH - 8) - 4;
            return <circle key={i} cx={x} cy={y} r={3} fill="white" stroke="#15824f" strokeWidth={2} />;
          })}
        </svg>
      ) : (
        <div className="h-[50px] flex items-center text-xs text-ink-300">Um único ponto de dados</div>
      )}

      <div className="mt-3 pt-3 border-t border-ink-100 space-y-3">
        {values.length > 0 && (
          <div className="space-y-1">
            {values.map((v, i) => (
              <div key={i} className="flex items-center justify-between text-xs">
                <span className="text-ink-400">{v.label}</span>
                <span className="font-semibold text-ink-700">{formatNumber(v.value)}</span>
              </div>
            ))}
          </div>
        )}

        {data.photos.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-400">Fotos revisadas</p>
              <span className="inline-flex items-center gap-1 text-[11px] text-brand-600">
                <ZoomIn size={12} /> {data.photos.length}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {data.photos.map((photo, idx) => (
                <button
                  type="button"
                  key={`${photo.date}-${idx}`}
                  onClick={() => onPreview({ url: photo.url, label: `${data.label} — ${photo.label}${photo.value != null ? ` (${formatNumber(photo.value)})` : ''}` })}
                  className="group relative overflow-hidden rounded-xl border border-ink-200 bg-ink-50 hover:border-brand-300 transition-colors"
                >
                  <img src={photo.url} alt={`${data.label} — ${photo.label}`} className="h-20 w-full object-cover" />
                  <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent px-2 py-1 text-[10px] text-white text-left">
                    {photo.value != null ? formatNumber(photo.value) : photo.label}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
