import { useEffect, useState } from 'react';
import {
  ArrowLeft,
  BarChart3,
  Calendar,
  Camera,
  Check,
  ChevronRight,
  Edit3,
  FileText,
  Layers,
  Loader2,
  Mail,
  Phone,
  Plus,
  Ruler,
  ScanEye,
  Sparkles,
  TrendingUp,
  User,
  X,
} from 'lucide-react';
import { listSessionsByPatient, updatePatient } from '@/lib/api';
import type { Patient, SessionWithPhotos } from '@/lib/types';
import {
  calcAge,
  formatDate,
  formatDateLong,
  formatNumber,
  formatThickness,
  maskCPF,
} from '@/lib/formatters';
import { ProgressChart, type ChartPoint } from '@/components/ProgressChart';
import { TrendBadge } from '@/components/TrendBadge';

interface Props {
  patient: Patient;
  onPatientUpdated: (patient: Patient) => void;
  onBack: () => void;
  onNewSession: () => void;
  onAnalyzeBySession: () => void;
  onAnalyzeByArea: () => void;
  onOpenSession: (session: SessionWithPhotos) => void;
}

type ChartMetric = 'bulbs' | 'strands' | 'thickness';

function computeVariation(values: number[]) {
  if (values.length < 2) {
    return { delta: null as number | null, deltaPct: null as number | null, hasComparison: false };
  }
  const first = values[0];
  const last = values[values.length - 1];
  const delta = last - first;
  const deltaPct = first > 0 ? (delta / first) * 100 : null;
  return { delta, deltaPct, hasComparison: true };
}

export function Dashboard({
  patient,
  onPatientUpdated,
  onBack,
  onNewSession,
  onAnalyzeBySession,
  onAnalyzeByArea,
  onOpenSession,
}: Props) {
  const [sessions, setSessions] = useState<SessionWithPhotos[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [metric, setMetric] = useState<ChartMetric>('bulbs');

  const [editingNotes, setEditingNotes] = useState(false);
  const [notesDraft, setNotesDraft] = useState(patient.notes ?? '');
  const [savingNotes, setSavingNotes] = useState(false);

  useEffect(() => {
    setNotesDraft(patient.notes ?? '');
  }, [patient.notes]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    listSessionsByPatient(patient.id)
      .then((data) => {
        if (active) setSessions(data);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : 'Erro ao carregar sessões.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [patient.id]);

  async function saveNotes() {
    setSavingNotes(true);
    try {
      const updated = await updatePatient(patient.id, { notes: notesDraft.trim() || null });
      onPatientUpdated({ ...patient, ...updated });
      setEditingNotes(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível salvar as anotações clínicas.');
    } finally {
      setSavingNotes(false);
    }
  }

  const bulbPoints: ChartPoint[] = sessions
    .filter((s) => s.total_hairs != null)
    .map((s) => ({ date: s.session_date, label: formatDate(s.session_date), value: s.total_hairs! }));

  const strandPoints: ChartPoint[] = sessions
    .filter((s) => s.avg_strands != null)
    .map((s) => ({ date: s.session_date, label: formatDate(s.session_date), value: s.avg_strands! }));

  const thicknessPoints: ChartPoint[] = sessions
    .filter((s) => s.avg_thickness_px != null)
    .map((s) => ({ date: s.session_date, label: formatDate(s.session_date), value: s.avg_thickness_px! }));

  const lastSession = sessions.length > 0 ? sessions[sessions.length - 1] : null;

  const latestBulbs = bulbPoints[bulbPoints.length - 1]?.value ?? null;
  const bulbTrend = computeVariation(bulbPoints.map((p) => p.value));

  const latestStrands = strandPoints[strandPoints.length - 1]?.value ?? null;
  const strandTrend = computeVariation(strandPoints.map((p) => p.value));

  const latestThickness = thicknessPoints[thicknessPoints.length - 1]?.value ?? null;
  const thicknessTrend = computeVariation(thicknessPoints.map((p) => p.value));

  const latestCoverage =
    [...sessions].reverse().find((s) => s.avg_coverage_pct != null)?.avg_coverage_pct ?? null;

  const totalPhotos = sessions.reduce((acc, s) => acc + s.session_photos.length, 0);

  const activeChartConfig =
    metric === 'strands'
      ? {
          points: strandPoints,
          unit: 'fios',
          decimals: 1,
          accent: 'teal' as const,
          subtitle: 'Média de fios capilares detectados por imagem (segmentação em grayscale)',
        }
      : metric === 'thickness'
        ? {
            points: thicknessPoints,
            unit: 'px',
            decimals: 2,
            accent: 'sky' as const,
            subtitle: 'Espessura média em pixels dos fios segmentados ao longo das consultas',
          }
        : {
            points: bulbPoints,
            unit: 'bulbos',
            decimals: 0,
            accent: 'brand' as const,
            subtitle: 'Contagem média de bulbos / unidades foliculares (origem e tracking de fios)',
          };

  const recentSessions = [...sessions].reverse().slice(0, 4);

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 animate-slide-up">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <button onClick={onBack} className="btn-ghost -ml-2">
          <ArrowLeft size={18} /> Trocar paciente
        </button>
        <button onClick={onNewSession} className="btn-primary">
          <Plus size={18} /> Nova consulta / sessão
        </button>
      </div>

      {error && (
        <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700 mb-5">
          {error}
        </div>
      )}

      {/* Prontuário resumido do paciente */}
      <div className="card p-6 mb-6">
        <div className="flex flex-col sm:flex-row sm:items-start gap-4">
          <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-brand-100 to-brand-200 flex items-center justify-center flex-shrink-0">
            <User size={28} className="text-brand-600" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h1 className="font-display text-2xl font-bold text-ink-900">{patient.name}</h1>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-ink-100 px-3 py-1 text-xs font-semibold text-ink-600">
                <Calendar size={13} />
                {lastSession ? `Última consulta: ${formatDate(lastSession.session_date)}` : 'Sem consultas'}
              </span>
            </div>
            <div className="flex flex-wrap gap-x-5 gap-y-1 mt-2 text-sm text-ink-500">
              {calcAge(patient.date_of_birth) != null && <span>{calcAge(patient.date_of_birth)} anos</span>}
              {patient.cpf && <span>CPF: {maskCPF(patient.cpf)}</span>}
              {patient.phone && (
                <span className="flex items-center gap-1">
                  <Phone size={13} /> {patient.phone}
                </span>
              )}
              {patient.email && (
                <span className="flex items-center gap-1">
                  <Mail size={13} /> {patient.email}
                </span>
              )}
              <span className="flex items-center gap-1">
                <Camera size={13} /> {sessions.length} {sessions.length === 1 ? 'sessão' : 'sessões'} · {totalPhotos}{' '}
                {totalPhotos === 1 ? 'imagem' : 'imagens'}
              </span>
            </div>
          </div>
        </div>

        {/* Anotações clínicas editáveis */}
        <div className="mt-4 pt-4 border-t border-ink-100">
          {editingNotes ? (
            <div className="space-y-2.5">
              <textarea
                className="input min-h-[76px] text-sm"
                placeholder="Hipótese diagnóstica, protocolo em uso (ex.: Minoxidil, Finasterida, MMP), observações..."
                value={notesDraft}
                onChange={(e) => setNotesDraft(e.target.value)}
              />
              <div className="flex items-center gap-2">
                <button type="button" onClick={saveNotes} disabled={savingNotes} className="btn-primary py-2 px-4 text-xs">
                  {savingNotes ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                  Salvar anotações
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setNotesDraft(patient.notes ?? '');
                    setEditingNotes(false);
                  }}
                  className="btn-ghost py-2 px-3 text-xs"
                >
                  <X size={14} /> Cancelar
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-2 text-sm text-ink-500">
                <FileText size={16} className="text-ink-400 mt-0.5 flex-shrink-0" />
                <p>{patient.notes || 'Nenhuma anotação clínica registrada para este paciente.'}</p>
              </div>
              <button
                type="button"
                onClick={() => setEditingNotes(true)}
                className="text-xs font-semibold text-brand-600 hover:text-brand-700 inline-flex items-center gap-1 flex-shrink-0"
              >
                <Edit3 size={13} /> Editar
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Área de Tricometria: Bulbos, Fios Detectados e Espessura Média em Pixel */}
      <div className="card p-6 mb-6 bg-gradient-to-br from-white via-white to-teal-50/40 border-teal-100/80">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-xl bg-teal-50 border border-teal-200/70 flex items-center justify-center">
              <Sparkles size={18} className="text-teal-600" />
            </div>
            <div>
              <h2 className="font-display text-lg font-bold text-ink-900">
                Painel Tricométrico — Fios e Bulbos
              </h2>
              <p className="text-xs text-ink-500">
                Detecção de bulbos via origem/tracking dos fios e segmentação em escala de cinza
              </p>
            </div>
          </div>
          {lastSession && (
            <span className="text-xs font-medium text-ink-400">
              Referência: {formatDateLong(lastSession.session_date)}
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Card 1: Bulbos */}
          <div className="rounded-2xl border border-ink-100 bg-white p-4">
            <div className="flex items-center gap-2 text-rose-500 mb-2">
              <ScanEye size={16} />
              <span className="text-xs font-semibold uppercase tracking-wide text-ink-500">Bulbos detectados</span>
            </div>
            <p className="font-display text-2xl font-bold text-ink-900">
              {latestBulbs != null ? formatNumber(latestBulbs) : '—'}
            </p>
            <div className="mt-1.5">
              <TrendBadge
                delta={bulbTrend.delta != null ? Math.round(bulbTrend.delta) : null}
                deltaPct={bulbTrend.deltaPct}
                hasComparison={bulbTrend.hasComparison}
                size={14}
              />
            </div>
          </div>

          {/* Card 2: Fios detectados */}
          <div className="rounded-2xl border border-teal-200/70 bg-white p-4">
            <div className="flex items-center gap-2 text-teal-600 mb-2">
              <Sparkles size={16} />
              <span className="text-xs font-semibold uppercase tracking-wide text-ink-500">Fios detectados</span>
            </div>
            <p className="font-display text-2xl font-bold text-teal-700">
              {latestStrands != null ? formatNumber(latestStrands, 1) : '—'}
            </p>
            <div className="mt-1.5">
              <TrendBadge
                delta={strandTrend.delta != null ? Number(strandTrend.delta.toFixed(1)) : null}
                deltaPct={strandTrend.deltaPct}
                hasComparison={strandTrend.hasComparison}
                size={14}
              />
            </div>
          </div>

          {/* Card 3: Espessura média em pixels */}
          <div className="rounded-2xl border border-sky-200/80 bg-white p-4">
            <div className="flex items-center gap-2 text-sky-600 mb-2">
              <Ruler size={16} />
              <span className="text-xs font-semibold uppercase tracking-wide text-ink-500">Espessura média</span>
            </div>
            <p className="font-display text-2xl font-bold text-sky-700">
              {formatThickness(latestThickness)}
            </p>
            <div className="mt-1.5">
              <TrendBadge
                delta={thicknessTrend.delta != null ? Number(thicknessTrend.delta.toFixed(2)) : null}
                deltaPct={thicknessTrend.deltaPct}
                hasComparison={thicknessTrend.hasComparison}
                size={14}
              />
            </div>
          </div>

          {/* Card 4: Cobertura capilar */}
          <div className="rounded-2xl border border-ink-100 bg-white p-4">
            <div className="flex items-center gap-2 text-brand-600 mb-2">
              <TrendingUp size={16} />
              <span className="text-xs font-semibold uppercase tracking-wide text-ink-500">Cobertura capilar</span>
            </div>
            <p className="font-display text-2xl font-bold text-ink-900">
              {latestCoverage != null ? `${formatNumber(latestCoverage, 1)}%` : '—'}
            </p>
            <p className="text-xs text-ink-400 mt-1.5">Área ocupada por fios na máscara</p>
          </div>
        </div>
      </div>

      {/* Gráfico evolutivo com seletor de métrica */}
      <div className="card p-6 mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-5">
          <div>
            <h2 className="font-display text-lg font-bold text-ink-900">Evolução ao longo das sessões</h2>
            <p className="text-sm text-ink-400">{activeChartConfig.subtitle}</p>
          </div>

          <div className="inline-flex rounded-xl bg-ink-100 p-1 self-start">
            <MetricTab active={metric === 'bulbs'} onClick={() => setMetric('bulbs')} label="Bulbos" />
            <MetricTab active={metric === 'strands'} onClick={() => setMetric('strands')} label="Fios detectados" />
            <MetricTab active={metric === 'thickness'} onClick={() => setMetric('thickness')} label="Espessura (px)" />
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16 text-ink-400">
            <Loader2 size={24} className="animate-spin" />
          </div>
        ) : (
          <ProgressChart
            points={activeChartConfig.points}
            unit={activeChartConfig.unit}
            decimals={activeChartConfig.decimals}
            accent={activeChartConfig.accent}
          />
        )}
      </div>

      {/* Ações rápidas de análise */}
      <div className="grid sm:grid-cols-2 gap-3 mb-6">
        <button onClick={onAnalyzeByArea} className="btn-secondary justify-between py-4 px-5">
          <span className="inline-flex items-center gap-2.5">
            <Layers size={18} className="text-brand-600" />
            <span>Analisar evolução por região do couro cabeludo</span>
          </span>
          <ChevronRight size={18} className="text-ink-400" />
        </button>
        <button onClick={onAnalyzeBySession} className="btn-secondary justify-between py-4 px-5">
          <span className="inline-flex items-center gap-2.5">
            <BarChart3 size={18} className="text-teal-600" />
            <span>Ver histórico completo de sessões</span>
          </span>
          <ChevronRight size={18} className="text-ink-400" />
        </button>
      </div>

      {/* Últimas sessões (acesso direto) */}
      {!loading && recentSessions.length > 0 && (
        <div className="card p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="font-display text-lg font-bold text-ink-900">Consultas recentes</h2>
              <p className="text-xs text-ink-400">Clique para inspecionar as máscaras e métricas da sessão</p>
            </div>
            {sessions.length > 4 && (
              <button type="button" onClick={onAnalyzeBySession} className="text-xs font-semibold text-brand-600 hover:underline">
                Ver todas ({sessions.length})
              </button>
            )}
          </div>

          <div className="divide-y divide-ink-100">
            {recentSessions.map((session) => (
              <button
                key={session.id}
                type="button"
                onClick={() => onOpenSession(session)}
                className="w-full py-3.5 flex flex-wrap items-center justify-between gap-3 text-left hover:bg-ink-50/70 -mx-2 px-2 rounded-xl transition-colors"
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-ink-900">{formatDateLong(session.session_date)}</p>
                  <p className="text-xs text-ink-400 mt-0.5">
                    {session.session_photos.length}{' '}
                    {session.session_photos.length === 1 ? 'imagem' : 'imagens'}
                    {session.notes ? ` · ${session.notes}` : ''}
                  </p>
                </div>

                <div className="flex items-center gap-4 text-xs">
                  <span className="rounded-lg bg-rose-50 px-2.5 py-1 font-semibold text-rose-700">
                    {formatNumber(session.total_hairs ?? 0)} bulbos
                  </span>
                  {session.avg_strands != null && (
                    <span className="rounded-lg bg-teal-50 px-2.5 py-1 font-semibold text-teal-700">
                      {formatNumber(session.avg_strands, 1)} fios
                    </span>
                  )}
                  {session.avg_thickness_px != null && (
                    <span className="rounded-lg bg-sky-50 px-2.5 py-1 font-semibold text-sky-700">
                      {formatThickness(session.avg_thickness_px)}
                    </span>
                  )}
                  <ChevronRight size={16} className="text-ink-300" />
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function MetricTab({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
        active ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-500 hover:text-ink-800'
      }`}
    >
      {label}
    </button>
  );
}
