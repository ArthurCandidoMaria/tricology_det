import { useEffect, useState } from 'react';
import { ArrowLeft, Calendar, Inbox, Loader2, Search, UserCircle2, UserPlus } from 'lucide-react';
import { listPatients } from '@/lib/api';
import { formatDate, maskCPF } from '@/lib/formatters';
import type { Patient } from '@/lib/types';

interface Props {
  onBack: () => void;
  onSelect: (patient: Patient) => void;
  onRegisterNew: () => void;
}

export function SelectPatient({ onBack, onSelect, onRegisterNew }: Props) {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    let active = true;
    listPatients()
      .then((data) => {
        if (active) setPatients(data);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : 'Erro ao carregar pacientes.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const normalizedQuery = query.trim().toLowerCase();
  const filtered = patients.filter(
    (p) =>
      p.name.toLowerCase().includes(normalizedQuery) ||
      (p.cpf ?? '').replace(/\D/g, '').includes(normalizedQuery.replace(/\D/g, '') || '__nomatch__') ||
      (p.cpf ?? '').toLowerCase().includes(normalizedQuery) ||
      (p.email ?? '').toLowerCase().includes(normalizedQuery),
  );

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 animate-slide-up">
      <div className="flex items-center justify-between gap-3 mb-6">
        <button onClick={onBack} className="btn-ghost -ml-2">
          <ArrowLeft size={18} /> Voltar
        </button>
        <button onClick={onRegisterNew} className="btn-secondary py-2 px-4 text-xs">
          <UserPlus size={15} /> Novo paciente
        </button>
      </div>

      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold text-ink-900">Pacientes</h1>
        <p className="text-sm text-ink-500 mt-1">
          Selecione um prontuário para visualizar a tricoscopia e o histórico de sessões.
        </p>
      </div>

      <div className="relative mb-5">
        <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-ink-400" />
        <input
          className="input pl-12"
          placeholder="Buscar por nome, CPF ou e-mail..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
        />
      </div>

      {error && (
        <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700 mb-5">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20 text-ink-400">
          <Loader2 size={28} className="animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="card p-12 text-center">
          <div className="inline-flex h-14 w-14 rounded-2xl bg-ink-100 items-center justify-center mb-4">
            <Inbox size={28} className="text-ink-400" />
          </div>
          <p className="text-ink-500 font-medium">
            {patients.length === 0
              ? 'Nenhum paciente cadastrado ainda.'
              : 'Nenhum paciente corresponde à sua busca.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((p) => (
            <button
              key={p.id}
              onClick={() => onSelect(p)}
              className="card w-full p-4 flex items-center gap-4 text-left hover:shadow-card hover:border-brand-300 transition-all duration-200 hover:-translate-y-0.5 group"
            >
              <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-ink-100 to-ink-200 flex items-center justify-center flex-shrink-0 group-hover:from-brand-100 group-hover:to-brand-200 transition-colors">
                <UserCircle2 size={26} className="text-ink-500 group-hover:text-brand-600 transition-colors" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-ink-900 truncate">{p.name}</p>
                <p className="text-xs text-ink-400 truncate mt-0.5">
                  {p.cpf ? `CPF: ${maskCPF(p.cpf)}` : p.email || 'Sem contato'}
                  {p.session_count != null && (
                    <span>
                      {' '}
                      · {p.session_count} {p.session_count === 1 ? 'sessão' : 'sessões'}
                    </span>
                  )}
                </p>
              </div>
              <div className="text-right flex-shrink-0">
                <p className="text-[11px] text-ink-400 flex items-center justify-end gap-1">
                  <Calendar size={11} /> {p.last_session_date ? 'Última consulta' : 'Cadastrado'}
                </p>
                <p className="text-sm font-medium text-ink-600">
                  {formatDate(p.last_session_date || p.created_at)}
                </p>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
