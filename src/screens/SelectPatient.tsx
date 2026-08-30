import { useEffect, useState } from 'react';
import { ArrowLeft, Search, UserCircle2, Loader2, Inbox } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import type { Patient } from '@/lib/types';
import { formatDate } from '@/lib/formatters';

interface Props {
  onBack: () => void;
  onSelect: (patient: Patient) => void;
}

export function SelectPatient({ onBack, onSelect }: Props) {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from('patients')
        .select('*')
        .order('created_at', { ascending: false });

      setLoading(false);
      if (!error && data) setPatients(data as Patient[]);
    })();
  }, []);

  const filtered = patients.filter((p) =>
    p.name.toLowerCase().includes(query.toLowerCase()) ||
    (p.cpf ?? '').includes(query) ||
    (p.email ?? '').toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 animate-slide-up">
      <button onClick={onBack} className="btn-ghost mb-6 -ml-2">
        <ArrowLeft size={18} /> Voltar
      </button>

      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold text-ink-900">Selecionar paciente</h1>
        <p className="text-sm text-ink-500 mt-1">Escolha um paciente para visualizar o painel e o progresso.</p>
      </div>

      <div className="relative mb-5">
        <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-ink-400" />
        <input
          className="input pl-12"
          placeholder="Buscar por nome, CPF ou e-mail..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

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
            {patients.length === 0 ? 'Nenhum paciente cadastrado ainda.' : 'Nenhum paciente corresponde à sua busca.'}
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
                <p className="text-sm text-ink-400 truncate">
                  {p.cpf ? `CPF: ${p.cpf}` : p.email || 'Sem contato'}
                </p>
              </div>
              <div className="text-right flex-shrink-0">
                <p className="text-xs text-ink-400">Cadastrado</p>
                <p className="text-sm font-medium text-ink-600">{formatDate(p.created_at)}</p>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
