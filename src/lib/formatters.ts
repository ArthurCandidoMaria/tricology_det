/**
 * Converte a data vinda do banco em Date local.
 * "2026-09-01" sem hora e interpretado pelo JS como UTC; em fusos negativos
 * (America/Sao_Paulo) isso joga o dia para tras e a sessao aparece com a
 * data errada. Aqui a data-only e montada em horario local.
 */
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

export function formatNumber(n: number | null | undefined): string {
  if (n == null) return '—';
  return n.toLocaleString('pt-BR');
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
