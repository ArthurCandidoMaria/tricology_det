import { User } from 'lucide-react';
import { LogoWordmark } from './Logo';

interface Props {
  onHome: () => void;
  patientName?: string | null;
  onPatientClick?: () => void;
}

export function Header({ onHome, patientName, onPatientClick }: Props) {
  return (
    <header className="sticky top-0 z-30 bg-white/85 backdrop-blur-md border-b border-ink-100">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={onHome}
            className="transition-transform hover:scale-[1.02] active:scale-[0.98] flex-shrink-0"
            title="Voltar ao início"
          >
            <LogoWordmark size="sm" />
          </button>

          {patientName && (
            <>
              <span className="text-ink-300 hidden sm:inline">/</span>
              <button
                type="button"
                onClick={onPatientClick}
                className="hidden sm:inline-flex items-center gap-1.5 rounded-full bg-brand-50 border border-brand-200/80 px-3 py-1 text-xs font-semibold text-brand-700 hover:bg-brand-100 transition-colors truncate max-w-[220px]"
                title="Voltar ao prontuário do paciente"
              >
                <User size={13} className="flex-shrink-0" />
                <span className="truncate">{patientName}</span>
              </button>
            </>
          )}
        </div>

        <div className="text-xs font-medium text-ink-400 hidden md:block">
          Tricoscopia digital · Bulbos, fios e calibre capilar
        </div>
      </div>
    </header>
  );
}
