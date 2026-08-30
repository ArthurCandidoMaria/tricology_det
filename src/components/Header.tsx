import { LogoWordmark } from './Logo';

export function Header({ onHome }: { onHome: () => void }) {
  return (
    <header className="sticky top-0 z-30 bg-white/80 backdrop-blur-md border-b border-ink-100">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
        <button onClick={onHome} className="transition-transform hover:scale-[1.02] active:scale-[0.98]">
          <LogoWordmark size="sm" />
        </button>
        <div className="text-xs font-medium text-ink-400 hidden sm:block">
          Sistema de acompanhamento de transplante capilar
        </div>
      </div>
    </header>
  );
}
