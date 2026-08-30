import { Activity } from 'lucide-react';

export function Logo({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const dims = { sm: 'h-8 w-8', md: 'h-10 w-10', lg: 'h-14 w-14' };
  const iconSize = { sm: 18, md: 22, lg: 30 };
  return (
    <div className={`${dims[size]} rounded-xl bg-gradient-to-br from-brand-400 to-brand-600 flex items-center justify-center shadow-soft`}>
      <Activity size={iconSize[size]} className="text-white" strokeWidth={2.5} />
    </div>
  );
}

export function LogoWordmark({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const textSize = { sm: 'text-base', md: 'text-lg', lg: 'text-2xl' };
  return (
    <div className="flex items-center gap-2.5">
      <Logo size={size} />
      <span className={`font-display ${textSize[size]} font-bold text-ink-900 tracking-tight`}>
        Follicle<span className="text-brand-500">Track</span>
      </span>
    </div>
  );
}
