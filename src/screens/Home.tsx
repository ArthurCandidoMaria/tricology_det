import { Activity, Ruler, ScanEye, Search, Sparkles, UserPlus } from 'lucide-react';

export function Home({ onRegister, onUpdate }: { onRegister: () => void; onUpdate: () => void }) {
  return (
    <div className="min-h-screen bg-gradient-to-b from-ink-50 via-white to-brand-50/30 flex flex-col">
      <div className="flex-1 flex flex-col items-center justify-center px-4 py-12">
        <div className="max-w-3xl w-full text-center mb-10 animate-fade-in">
          <div className="inline-flex items-center justify-center h-16 w-16 rounded-2xl bg-gradient-to-br from-brand-400 to-brand-600 shadow-card mb-5">
            <Activity size={32} className="text-white" strokeWidth={2.5} />
          </div>
          <h1 className="font-display text-4xl sm:text-5xl font-bold text-ink-900 tracking-tight mb-3">
            Follicle<span className="text-brand-500">Track</span>
          </h1>
          <p className="text-sm sm:text-base text-ink-500 max-w-xl mx-auto">
            Plataforma de tricoscopia digital para contagem de bulbos, segmentação de fios em escala de cinza e medição de espessura capilar.
          </p>

          <div className="flex flex-wrap items-center justify-center gap-2 mt-5 text-xs font-medium text-ink-600">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white border border-ink-200/80 px-3 py-1">
              <ScanEye size={13} className="text-rose-500" /> Bulbos por origem dos fios
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white border border-ink-200/80 px-3 py-1">
              <Sparkles size={13} className="text-teal-600" /> Máscaras separadas (fios × couro)
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white border border-ink-200/80 px-3 py-1">
              <Ruler size={13} className="text-sky-600" /> Calibre médio em pixels
            </span>
          </div>
        </div>

        <div className="grid sm:grid-cols-2 gap-5 w-full max-w-3xl animate-slide-up">
          <button
            onClick={onUpdate}
            className="group card p-8 text-left hover:shadow-card hover:border-brand-300 transition-all duration-300 hover:-translate-y-0.5"
          >
            <div className="h-14 w-14 rounded-2xl bg-brand-50 flex items-center justify-center mb-5 group-hover:bg-brand-100 transition-colors">
              <Search size={30} className="text-brand-600" strokeWidth={2} />
            </div>
            <h2 className="font-display text-xl font-bold text-ink-900 mb-1.5">Abrir prontuário de paciente</h2>
            <p className="text-sm text-ink-500">
              Consulte o histórico tricoscópico, evolução de fios/bulbos ou registre uma nova sessão.
            </p>
            <div className="mt-5 inline-flex items-center gap-1 text-sm font-semibold text-brand-600 group-hover:gap-2 transition-all">
              Selecionar paciente
              <span className="transition-transform group-hover:translate-x-0.5">→</span>
            </div>
          </button>

          <button
            onClick={onRegister}
            className="group card p-8 text-left hover:shadow-card hover:border-teal-300 transition-all duration-300 hover:-translate-y-0.5"
          >
            <div className="h-14 w-14 rounded-2xl bg-teal-50 flex items-center justify-center mb-5 group-hover:bg-teal-100 transition-colors">
              <UserPlus size={30} className="text-teal-600" strokeWidth={2} />
            </div>
            <h2 className="font-display text-xl font-bold text-ink-900 mb-1.5">Cadastrar novo paciente</h2>
            <p className="text-sm text-ink-500">
              Inicie o acompanhamento clínico de um novo paciente com análise tricoscópica.
            </p>
            <div className="mt-5 inline-flex items-center gap-1 text-sm font-semibold text-teal-600 group-hover:gap-2 transition-all">
              Novo cadastro
              <span className="transition-transform group-hover:translate-x-0.5">→</span>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
}
