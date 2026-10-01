import type { CoverageDay, ReportDetails } from './db';
import { combine, subtract, type AreaFeature } from './coverage';

export type TargetPeriod = 'daily' | 'weekly' | 'monthly' | 'quarterly';
export type SignRole = 'prepared' | 'checked' | 'approved';
export interface Target { areaHa: number | null; dueDate: string; geometry?: AreaFeature | null }
export interface Signatory { name: string; position: string; signature: string }
export interface PhotoPair { before: string; after: string; caption: string }
export interface Reporting {
  quarterRound: string;
  targetPeriod: TargetPeriod;
  targets: Record<string, Target>;
  signatories: Record<SignRole, Signatory>;
  photos: PhotoPair[];
}

export const displayDate = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date)
  ? `${date.slice(5, 7)}/${date.slice(8, 10)}/${date.slice(0, 4)}` : '—';
const iso = (d: Date) => d.toISOString().slice(0, 10);

// UTC arithmetic keeps calendar periods stable across timezones and DST changes.
export function targetWindow(period: TargetPeriod, date: string) {
  const d = new Date(`${date}T12:00:00Z`);
  if (!Number.isFinite(d.getTime())) throw new Error('Choose a valid report date.');
  const year = d.getUTCFullYear(), month = d.getUTCMonth();
  let start = new Date(d), end = new Date(d);
  if (period === 'weekly') {
    start.setUTCDate(d.getUTCDate() - (d.getUTCDay() + 6) % 7);
    end = new Date(start); end.setUTCDate(start.getUTCDate() + 6);
  } else if (period === 'monthly' || period === 'quarterly') {
    const startMonth = period === 'quarterly' ? Math.floor(month / 3) * 3 : month;
    start = new Date(Date.UTC(year, startMonth, 1, 12));
    end = new Date(Date.UTC(year, startMonth + (period === 'quarterly' ? 3 : 1), 0, 12));
  }
  return { start: iso(start), end: iso(end), key: `${period}:${iso(start)}` };
}

export function defaultReporting(details: ReportDetails): Reporting {
  return {
    quarterRound: `Q${Math.floor((Number(details.reportDate.slice(5, 7)) - 1) / 3) + 1}`,
    targetPeriod: 'daily', targets: {},
    signatories: {
      prepared: { name: details.preparedBy || '', position: '', signature: '' },
      checked: { name: '', position: '', signature: '' },
      approved: { name: '', position: '', signature: '' },
    },
    photos: [0, 1].map(() => ({ before: '', after: '', caption: '' })),
  };
}

const safeImage = (value: unknown): string => typeof value === 'string' &&
  /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value) ? value : '';

export function normalizeReporting(raw: Partial<Reporting> | undefined, details: ReportDetails): Reporting {
  const result = defaultReporting(details);
  if (!raw) return result;
  if (typeof raw.quarterRound === 'string') result.quarterRound = raw.quarterRound;
  if (['daily', 'weekly', 'monthly', 'quarterly'].includes(raw.targetPeriod || '')) result.targetPeriod = raw.targetPeriod!;
  for (const [key, value] of Object.entries(raw.targets || {})) {
    if (!/^(daily|weekly|monthly|quarterly):\d{4}-\d{2}-\d{2}$/.test(key) || !value) continue;
    const geometry = value.geometry?.type === 'Feature' &&
      (value.geometry.geometry?.type === 'Polygon' || value.geometry.geometry?.type === 'MultiPolygon')
      ? value.geometry : null;
    result.targets[key] = { areaHa: typeof value.areaHa === 'number' && Number.isFinite(value.areaHa) && value.areaHa > 0 ? value.areaHa : null,
      dueDate: typeof value.dueDate === 'string' ? value.dueDate : '', geometry };
  }
  for (const role of ['prepared', 'checked', 'approved'] as const) {
    const person = raw.signatories?.[role];
    if (person) result.signatories[role] = { name: String(person.name || ''), position: String(person.position || ''), signature: safeImage(person.signature) };
  }
  result.photos = [0, 1].map(i => ({ before: safeImage(raw.photos?.[i]?.before), after: safeImage(raw.photos?.[i]?.after), caption: String(raw.photos?.[i]?.caption || '') }));
  return result;
}

// A location displays its most recent work date, without stacking older tints.
export function datedVisibleAreas(days: CoverageDay[], exclusions: AreaFeature | null) {
  let newer: AreaFeature | null = null;
  const result: CoverageDay[] = [];
  for (const day of [...days].sort((a,b) => b.date.localeCompare(a.date))) {
    const geometry = subtract(subtract(day.geometry, exclusions), newer);
    if (geometry) result.push({ ...day, geometry });
    newer = combine([...(newer ? [newer] : []), day.geometry]);
  }
  return result.reverse();
}

export function historyColor(date: string, start: string, end: string) {
  const span = Date.parse(end) - Date.parse(start);
  const ratio = span <= 0 ? 1 : Math.max(0, Math.min(1, (Date.parse(date) - Date.parse(start)) / span));
  const rgb = [105, 214, 246].map((c, i) => Math.round(c + ([46, 49, 146][i] - c) * ratio));
  return `rgba(${rgb.join(',')},${0.5 + ratio * 0.25})`;
}
