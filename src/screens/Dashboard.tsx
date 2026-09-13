import { useEffect, useState } from 'react';
import {
  ArrowLeft, Plus, BarChart3, Calendar, TrendingUp, TrendingDown, Minus,
  User, Phone, Mail, FileText, Loader2, Camera,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import type { Patient, SessionWithPhotos } from '@/lib/types';
import { formatDate, formatDateLong, formatNumber, calcAge, maskCPF } from '@/lib/formatters';
import { ProgressChart, type ChartPoint } from '@/components/ProgressChart';

interface Props {
  patient: Patient;
  onBack: () => void;
  onNewSession: () => void;
  onAnalyzeBySession: () => void;
}

export function Dashboard({ patient, onBack, onNewSession, onAnalyzeBySession }: Props) {
  const [sessions, setSessions] = useState<SessionWithPhotos[]>([]);
  const [loading, setLoading] = useState(true);

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

  const chartPoints: ChartPoint[] = sessions
    .filter((s) => s.total_hairs != null)
    .map((s) => ({
      date: s.session_date,
      label: formatDate(s.session_date),
      value: s.total_hairs!,
    }));

  const lastSession = sessions.length > 0 ? sessions[sessions.length - 1] : null;
  const firstValue = chartPoints[0]?.value ?? null;
  const lastValue = chartPoints[chartPoints.length - 1]?.value ?? null;
  const delta = firstValue != null && lastValue != null ? lastValue - firstValue : null;
  const deltaPct = firstValue && lastValue ? ((lastValue - firstValue) / firstValue) * 100 : null;

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 animate-slide-up">
      <button onClick={onBack} className="btn-ghost mb-6 -ml-2">
        <ArrowLeft size={18} /> Voltar
      </button>

      {/* Patient header */}
      <div className="card p-6 mb-6">
        <div className="flex flex-col sm:flex-row sm:items-start gap-4">
          <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-brand-100 to-brand-200 flex items-center justify-center flex-shrink-0">
            <User size={32} className="text-brand-600" />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="font-display text-2xl font-bold text-ink-900">{patient.name}</h1>
            <div className="flex flex-wrap gap-x-5 gap-y-1 mt-2 text-sm text-ink-500">
              {calcAge(patient.date_of_birth) != null && <span>{calcAge(patient.date_of_birth)} anos</span>}
              {patient.cpf && <span>CPF: {maskCPF(patient.cpf)}</span>}
              {patient.phone && <span className="flex items-center gap-1"><Phone size={13} /> {patient.phone}</span>}
              {patient.email && <span className="flex items-center gap-1"><Mail size={13} /> {patient.email}</span>}
            </div>
          </div>
        </div>
        {patient.notes && (
          <div className="mt-4 pt-4 border-t border-ink-100 flex items-start gap-2">
            <FileText size={16} className="text-ink-400 mt-0.5 flex-shrink-0" />
            <p className="text-sm text-ink-500">{patient.notes}</p>
          </div>
        )}
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard
          icon={<Calendar size={18} />}
          label="Última consulta"
          value={lastSession ? formatDate(lastSession.session_date) : '—'}
          sublabel={lastSession ? formatDateLong(lastSession.session_date) : 'Nenhuma sessão ainda'}
        />
        <StatCard
          icon={<Camera size={18} />}
          label="Total de sessões"
          value={String(sessions.length)}
          sublabel={sessions.length === 1 ? 'sessão registrada' : 'sessões registradas'}
        />
        <StatCard
          icon={<TrendingUp size={18} />}
          label="Última contagem"
          value={lastValue != null ? formatNumber(lastValue) : '—'}
          sublabel="fios/folículos"
        />
        <StatCard
          icon={delta == null ? <Minus size={18} /> : delta >= 0 ? <TrendingUp size={18} /> : <TrendingDown size={18} />}
          label="Variação geral"
          value={delta != null ? `${delta >= 0 ? '+' : ''}${formatNumber(delta)}` : '—'}
          sublabel={delta != null && deltaPct != null ? `${delta >= 0 ? '+' : ''}${deltaPct.toFixed(1)}%` : '—'}
          valueClass={delta == null ? '' : delta >= 0 ? 'text-brand-600' : 'text-red-500'}
        />
      </div>

      {/* Chart */}
      <div className="card p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="font-display text-lg font-bold text-ink-900">Progresso ao longo do tempo</h2>
            <p className="text-sm text-ink-400">Contagem de fios/folículos em todas as sessões</p>
          </div>
        </div>
        {loading ? (
          <div className="flex items-center justify-center py-16 text-ink-400">
            <Loader2 size={24} className="animate-spin" />
          </div>
        ) : (
          <ProgressChart points={chartPoints} />
        )}
      </div>

      {/* Actions */}
      <div className="flex flex-col sm:flex-row gap-3">
        <button onClick={onNewSession} className="btn-primary flex-1">
          <Plus size={18} /> Nova sessão
        </button>
        <button onClick={onAnalyzeBySession} className="btn-secondary flex-1">
          <BarChart3 size={18} /> Analisar por sessão
        </button>
      </div>
    </div>
  );
}

function StatCard({
  icon, label, value, sublabel, valueClass,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sublabel: string;
  valueClass?: string;
}) {
  return (
    <div className="card p-5">
      <div className="flex items-center gap-2 text-ink-400 mb-2">
        {icon}
        <span className="text-xs font-semibold uppercase tracking-wide">{label}</span>
      </div>
      <p className={`font-display text-xl font-bold ${valueClass ?? 'text-ink-900'}`}>{value}</p>
      <p className="text-xs text-ink-400 mt-0.5">{sublabel}</p>
    </div>
  );
}
