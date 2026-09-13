import { UserPlus, Search, Activity, BarChart3, Camera } from 'lucide-react';

export function Home({ onRegister, onUpdate }: { onRegister: () => void; onUpdate: () => void }) {
  return (
    <div className="min-h-screen bg-gradient-to-b from-ink-50 via-white to-brand-50/30 flex flex-col">
      <div className="flex-1 flex flex-col items-center justify-center px-4 py-12">
        <div className="max-w-3xl w-full text-center mb-12 animate-fade-in">
          <div className="inline-flex items-center justify-center h-16 w-16 rounded-2xl bg-gradient-to-br from-brand-400 to-brand-600 shadow-card mb-6">
            <Activity size={32} className="text-white" strokeWidth={2.5} />
          </div>
          <h1 className="font-display text-4xl sm:text-5xl font-bold text-ink-900 tracking-tight mb-3">
            Follicle<span className="text-brand-500">Track</span>
          </h1>
        </div>

        <div className="grid sm:grid-cols-2 gap-5 w-full max-w-3xl animate-slide-up">
          <button
            onClick={onRegister}
            className="group card p-8 text-left hover:shadow-card hover:border-brand-300 transition-all duration-300 hover:-translate-y-0.5"
          >
            <div className="h-14 w-14 rounded-2xl bg-brand-50 flex items-center justify-center mb-5 group-hover:bg-brand-100 transition-colors">
              <UserPlus size={32} className="text-brand-600" strokeWidth={2} />
            </div>
            <h2 className="font-display text-xl font-bold text-ink-900 mb-2">Cadastrar novo paciente</h2>
            <div className="mt-5 inline-flex items-center gap-1 text-sm font-semibold text-brand-600 group-hover:gap-2 transition-all">
              Começar
              <span className="transition-transform group-hover:translate-x-0.5">→</span>
            </div>
          </button>

          <button
            onClick={onUpdate}
            className="group card p-8 text-left hover:shadow-card hover:border-accent-300 transition-all duration-300 hover:-translate-y-0.5"
          >
            <div className="h-14 w-14 rounded-2xl bg-accent-50 flex items-center justify-center mb-5 group-hover:bg-accent-100 transition-colors">
              <Search size={32} className="text-accent-600" strokeWidth={2} />
            </div>
            <h2 className="font-display text-xl font-bold text-ink-900 mb-2">Atualizar paciente existente</h2>
            <div className="mt-5 inline-flex items-center gap-1 text-sm font-semibold text-accent-600 group-hover:gap-2 transition-all">
              Selecionar paciente
              <span className="transition-transform group-hover:translate-x-0.5">→</span>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
}

function Feature({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex flex-col items-center gap-2 text-ink-400">
      <div className="h-10 w-10 rounded-xl bg-ink-100 flex items-center justify-center text-ink-500">
        {icon}
      </div>
      <span className="text-xs font-medium">{label}</span>
    </div>
  );
}
