import { useState } from 'react';
import { ArrowLeft, UserPlus, Loader2, Check } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import type { Patient } from '@/lib/types';

interface Props {
  onBack: () => void;
  onCreated: (patient: Patient) => void;
}

export function RegisterPatient({ onBack, onCreated }: Props) {
  const [form, setForm] = useState({
    name: '',
    date_of_birth: '',
    cpf: '',
    phone: '',
    email: '',
    notes: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function update<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function formatCPF(value: string): string {
    const d = value.replace(/\D/g, '').slice(0, 11);
    if (d.length <= 3) return d;
    if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
    if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
    return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  }

  function formatPhone(value: string): string {
    const d = value.replace(/\D/g, '').slice(0, 11);
    if (d.length <= 2) return d;
    if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
    if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
    return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) {
      setError('Nome é obrigatório.');
      return;
    }
    setSaving(true);
    setError(null);

    const { data, error: dbError } = await supabase
      .from('patients')
      .insert({
        name: form.name.trim(),
        date_of_birth: form.date_of_birth || null,
        cpf: form.cpf || null,
        phone: form.phone || null,
        email: form.email || null,
        notes: form.notes || null,
      })
      .select()
      .maybeSingle();

    setSaving(false);

    if (dbError || !data) {
      setError(dbError?.message || 'Falha ao cadastrar paciente. Tente novamente.');
      return;
    }

    onCreated(data as Patient);
  }

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8 animate-slide-up">
      <button onClick={onBack} className="btn-ghost mb-6 -ml-2">
        <ArrowLeft size={18} /> Voltar
      </button>

      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <div className="h-11 w-11 rounded-xl bg-brand-50 flex items-center justify-center">
            <UserPlus size={24} className="text-brand-600" />
          </div>
          <div>
            <h1 className="font-display text-2xl font-bold text-ink-900">Cadastrar novo paciente</h1>
            <p className="text-sm text-ink-500">Informe os dados básicos do paciente para começar o acompanhamento.</p>
          </div>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="card p-6 sm:p-8 space-y-5">
        <div>
          <label className="label">Nome completo <span className="text-brand-500">*</span></label>
          <input
            className="input"
            placeholder="Ex.: João Silva"
            value={form.name}
            onChange={(e) => update('name', e.target.value)}
            autoFocus
          />
        </div>

        <div className="grid sm:grid-cols-2 gap-5">
          <div>
            <label className="label">Data de nascimento</label>
            <input
              type="date"
              className="input"
              value={form.date_of_birth}
              onChange={(e) => update('date_of_birth', e.target.value)}
            />
          </div>
          <div>
            <label className="label">CPF</label>
            <input
              className="input"
              placeholder="000.000.000-00"
              value={form.cpf}
              onChange={(e) => update('cpf', formatCPF(e.target.value))}
            />
          </div>
        </div>

        <div className="grid sm:grid-cols-2 gap-5">
          <div>
            <label className="label">Telefone</label>
            <input
              className="input"
              placeholder="(00) 00000-0000"
              value={form.phone}
              onChange={(e) => update('phone', formatPhone(e.target.value))}
            />
          </div>
          <div>
            <label className="label">E-mail</label>
            <input
              type="email"
              className="input"
              placeholder="paciente@email.com"
              value={form.email}
              onChange={(e) => update('email', e.target.value)}
            />
          </div>
        </div>

        <div>
          <label className="label">Observações</label>
          <textarea
            className="input min-h-[80px] resize-y"
            placeholder="Qualquer observação médica relevante..."
            value={form.notes}
            onChange={(e) => update('notes', e.target.value)}
          />
        </div>

        {error && (
          <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="flex items-center gap-3 pt-2">
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? <Loader2 size={18} className="animate-spin" /> : <Check size={18} />}
            {saving ? 'Cadastrando...' : 'Cadastrar paciente'}
          </button>
          <button type="button" className="btn-secondary" onClick={onBack} disabled={saving}>
            Cancelar
          </button>
        </div>
      </form>
    </div>
  );
}
