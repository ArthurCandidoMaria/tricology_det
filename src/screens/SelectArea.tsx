import { useEffect, useState } from 'react';
import { ArrowLeft, ChevronRight, Loader2, Map as MapIcon } from 'lucide-react';
import { listSessionsByPatient } from '@/lib/api';
import type { Patient, SessionWithPhotos } from '@/lib/types';
import { formatNumber, formatThickness } from '@/lib/formatters';
import { buildAreaSummaries, type AreaSummary } from '@/lib/areaStats';
import { TrendBadge } from '@/components/TrendBadge';

interface Props {
  patient: Patient;
  onBack: () => void;
  onSelectArea: (area: AreaSummary) => void;
}

export function SelectArea({ patient, onBack, onSelectArea }: Props) {
  const [sessions, setSessions] = useState<SessionWithPhotos[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    listSessionsByPatient(patient.id)
      .then((data) => {
        if (active) setSessions(data);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [patient.id]);

  const areas = buildAreaSummaries(sessions);

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 animate-slide-up">
      <button onClick={onBack} className="btn-ghost mb-6 -ml-2">
        <ArrowLeft size={18} /> Voltar ao painel
      </button>

      <div className="mb-6">
        <div className="flex items-center gap-3 mb-1">
          <div className="h-10 w-10 rounded-xl bg-brand-50 flex items-center justify-center">
            <MapIcon size={22} className="text-brand-600" />
          </div>
          <h1 className="font-display text-2xl font-bold text-ink-900">Analisar por região</h1>
        </div>
        <p className="text-sm text-ink-500">
          Escolha uma região do couro cabeludo de <strong>{patient.name}</strong> para comparar bulbos, fios e espessura ao longo do tratamento.
        </p>
      </div>

      {loading ? (
        <div className="card flex items-center justify-center py-16 text-ink-400">
          <Loader2 size={28} className="animate-spin" />
        </div>
      ) : areas.length === 0 ? (
        <div className="card p-12 text-center">
          <p className="text-ink-500 font-medium">Nenhuma região registrada ainda.</p>
          <p className="text-sm text-ink-400 mt-1">
            Crie uma sessão com fotos atribuídas às regiões do couro cabeludo para acompanhar a evolução aqui.
          </p>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 gap-4">
          {areas.map((area) => (
            <button
              key={area.area}
              type="button"
              onClick={() => onSelectArea(area)}
              className="card p-5 text-left hover:border-brand-300 hover:shadow-card transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
            >
              <div className="flex items-start justify-between gap-3 mb-3">
                <div className="min-w-0">
                  <h2 className="font-display font-bold text-ink-900">{area.label}</h2>
                  <p className="text-xs text-ink-400 mt-0.5">
                    {area.sessionCount} {area.sessionCount === 1 ? 'sessão' : 'sessões'} · {area.photoCount}{' '}
                    {area.photoCount === 1 ? 'imagem' : 'imagens'}
                  </p>
                </div>
                <ChevronRight size={18} className="text-ink-300 flex-shrink-0 mt-1" />
              </div>

              <div className="flex items-end justify-between gap-3">
                <div>
                  <p className="text-xs text-ink-400">Bulbos (recente)</p>
                  <p className="font-display text-2xl font-bold text-ink-900">
                    {area.latest != null ? formatNumber(area.latest) : '—'}
                  </p>
                </div>
                <TrendBadge delta={area.delta} deltaPct={area.deltaPct} hasComparison={area.hasComparison} />
              </div>

              {(area.latestStrands != null || area.latestThicknessPx != null) && (
                <div className="flex flex-wrap gap-1.5 mt-3">
                  {area.latestStrands != null && (
                    <span className="rounded-lg bg-teal-50 px-2 py-0.5 text-xs font-semibold text-teal-700">
                      {formatNumber(area.latestStrands, 1)} fios
                    </span>
                  )}
                  {area.latestThicknessPx != null && (
                    <span className="rounded-lg bg-sky-50 px-2 py-0.5 text-xs font-semibold text-sky-700">
                      {formatThickness(area.latestThicknessPx)}
                    </span>
                  )}
                </div>
              )}

              <Sparkline area={area} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Sparkline({ area }: { area: AreaSummary }) {
  const W = 220;
  const H = 44;

  if (area.points.length < 2) {
    return (
      <div className="mt-3 pt-3 border-t border-ink-100 text-xs text-ink-400">
        Uma única sessão registrada — registre outra consulta para ver a curva.
      </div>
    );
  }

  const vals = area.points.map((p) => p.avg);
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const range = hi - lo || 1;

  const coords = area.points.map((p, i) => ({
    x: (i / (area.points.length - 1)) * W,
    y: H - ((p.avg - lo) / range) * (H - 10) - 5,
  }));
  const d = coords.map((c, i) => `${i === 0 ? 'M' : 'L'} ${c.x.toFixed(1)} ${c.y.toFixed(1)}`).join(' ');

  return (
    <div className="mt-3 pt-3 border-t border-ink-100">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: H }}>
        <path d={d} fill="none" stroke="#22a163" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {coords.map((c, i) => (
          <circle key={i} cx={c.x} cy={c.y} r={3} fill="white" stroke="#15824f" strokeWidth={2} />
        ))}
      </svg>
    </div>
  );
}
