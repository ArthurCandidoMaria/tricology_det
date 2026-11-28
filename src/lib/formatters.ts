function parseDate(dateStr: string | null): Date | null {
  if (!dateStr) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.trim());
  if (match) {
    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  }
  const parsed = new Date(dateStr);
  return isNaN(parsed.getTime()) ? null : parsed;
}

export function formatDate(dateStr: string | null): string {
  const d = parseDate(dateStr);
  if (!d) return '—';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yy = String(d.getFullYear()).slice(2);
  return `${dd}/${mm}/${yy}`;
}

export function formatDateLong(dateStr: string | null): string {
  const d = parseDate(dateStr);
  if (!d) return '—';
  return d.toLocaleDateString('pt-BR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export function formatNumber(n: number | null | undefined, maxDecimals = 0): string {
  if (n == null || Number.isNaN(n)) return '—';
  return n.toLocaleString('pt-BR', {
    minimumFractionDigits: maxDecimals > 0 ? maxDecimals : 0,
    maximumFractionDigits: maxDecimals,
  });
}

export function formatThickness(px: number | null | undefined): string {
  if (px == null || Number.isNaN(px)) return '—';
  return `${formatNumber(px, 2)} px`;
}

export function calcAge(dateOfBirth: string | null): number | null {
  const d = parseDate(dateOfBirth);
  if (!d) return null;
  const diff = Date.now() - d.getTime();
  return Math.floor(diff / (365.25 * 24 * 60 * 60 * 1000));
}

export function maskCPF(cpf: string | null): string {
  if (!cpf) return '—';
  const digits = cpf.replace(/\D/g, '');
  if (digits.length !== 11) return cpf;
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
}
