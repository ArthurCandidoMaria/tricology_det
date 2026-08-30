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
          <p className="text-lg text-ink-500 max-w-xl mx-auto">
            Acompanhe o progresso do transplante capilar com análise de fotos, medições por área e gráficos visuais de evolução.
          </p>
        </div>

        <div className="grid sm:grid-cols-2 gap-5 w-full max-w-3xl animate-slide-up">
          <button
            onClick={onRegister}
            className="group card p-8 text-left hover:shadow-card hover:border-brand-300 transition-all duration-300 hover:-translate-y-0.5"
          >
            <div className="h-14 w-14 rounded-2xl bg-brand-50 flex items-center justify-center mb-5 group-hover:bg-brand-100 transition-colors">
              <UserPlus size={28} className="text-brand-600" strokeWidth={2} />
            </div>
            <h2 className="font-display text-xl font-bold text-ink-900 mb-2">Cadastrar novo paciente</h2>
            <p className="text-sm text-ink-500 leading-relaxed">
              Informe os dados básicos do paciente — nome, data de nascimento, CPF, telefone — e comece a acompanhar o progresso.
            </p>
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
              <Search size={28} className="text-accent-600" strokeWidth={2} />
            </div>
            <h2 className="font-display text-xl font-bold text-ink-900 mb-2">Atualizar paciente existente</h2>
            <p className="text-sm text-ink-500 leading-relaxed">
              Selecione um paciente do cadastro e acesse o painel para adicionar novas sessões ou revisar o progresso.
            </p>
            <div className="mt-5 inline-flex items-center gap-1 text-sm font-semibold text-accent-600 group-hover:gap-2 transition-all">
              Selecionar paciente
              <span className="transition-transform group-hover:translate-x-0.5">→</span>
            </div>
          </button>
        </div>

        <div className="mt-14 grid grid-cols-3 gap-4 sm:gap-8 max-w-2xl w-full animate-fade-in" style={{ animationDelay: '0.15s' }}>
          <Feature icon={<Camera size={20} />} label="Análise de fotos" />
          <Feature icon={<BarChart3 size={20} />} label="Gráficos de progresso" />
          <Feature icon={<Activity size={20} />} label="Acompanhamento por área" />
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
