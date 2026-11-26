import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as T from '../lib/centralino/testiDirezione';
import { KPI } from '../lib/centralino/registro';
import { CANALI, ESITI, NOME_TIPO, RICHIESTE } from '../lib/centralino/tipi';

/**
 * Regola del titolare (25/11/2026): nelle pagine Direzione e nel Report Direzione ogni parola deve essere chiara.
 * Niente chiavi interne (manutenzione, offerta_grande, chiusa_ok…), niente inglese, niente sigle (SLA, TMQ, KPI).
 */
/** «manutenzione» è una parola normale dentro una frase; è vietata solo come nome da sola (era la chiave del tipo). */
const SOLO_NOME = /^\s*manutenzione\s*$/i;
const CHIAVI = ['offerta_piccola', 'offerta_grande', 'offerta_tablet', 'chiusa_ok', 'chiusa_ko', 'tablet_tmq', 'da_inviare', 'in_attesa', 'non_accettata', 'sla_', 'ct-', 'dz-', 'pratiche_', 'chiamate_trasferite'];
const VIETATE = [/\bSLA\b/i, /\bTMQ\b/, /\bKPI\b/, /\bnumeratore\b/i, /\bdenominatore\b/i, /\bTecnico Commerciale\b/, /\bResend\b/, /\bfeed\b/i, /\bdashboard\b/i, /\bset\b/i, /\breport_direzione\b/, /\banagrafica\b/i];
const vietato = (s: string) => (SOLO_NOME.test(s) ? 'manutenzione' : undefined) ?? CHIAVI.find(k => s.toLowerCase().includes(k)) ?? VIETATE.find(r => r.test(s))?.source;

function testi(): [string, string][] {
  const out: [string, string][] = [];
  for (const [nome, v] of Object.entries(T)) {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) continue;
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (typeof x === 'string') out.push([`${nome}.${k}`, x]);
      else if (x && typeof x === 'object' && 'it' in x) { const y = x as { it: string; def?: string }; out.push([`${nome}.${k}`, y.it]); if (y.def) out.push([`${nome}.${k}.def`, y.def]); }
    }
  }
  return out;
}

describe('testi Direzione chiari', () => {
  it('nessuna chiave interna o sigla nei testi di testiDirezione.ts', () => {
    const errati = testi().map(([k, s]) => [k, s, vietato(s)]).filter(x => x[2]);
    expect(errati).toEqual([]);
  });
  it('ogni testo ha il significato in arabo', () => {
    for (const [nome, v] of Object.entries(T)) {
      if (typeof v !== 'object' || v === null || Array.isArray(v) || nome === 'FILTRI_NOMI' || nome === 'MOTIVI_AR') continue;
      for (const [k, x] of Object.entries(v as Record<string, { ar?: string }>)) expect(x.ar, `${nome}.${k}`).toBeTruthy();
    }
  });
  it('nomi dei tipi: mai la chiave, sempre le parole decise', () => {
    expect(T.nomeTipo('manutenzione')).toBe('Intervento tecnico');
    expect(T.nomeTipo('modifica')).toBe('Modifica dati o disdetta');
    expect(T.nomeTipo('offerta_grande')).toBe('Offerta passata a un collega');
    expect(T.nomeTipo('offerta_piccola')).toBe('Offerta fatta da Jennifer');
    expect(T.nomeTipo('offerta_tablet')).toBe('Offerta da tablet del tecnico');
    expect(T.nomeTipo('sconosciuto')).toBe('Altro');
    for (const [k, l] of Object.entries(NOME_TIPO)) { expect(l).not.toBe(k); expect(vietato(l), l).toBeUndefined(); }
    for (const r of RICHIESTE) expect(vietato(r.l), r.l).toBeUndefined();
    for (const c of CANALI) expect(vietato(c.l), c.l).toBeUndefined();
    for (const [, l] of Object.values(ESITI)) expect(vietato(l), l).toBeUndefined();
  });
  it('ogni numero del registro ha titolo e definizione chiari', () => {
    for (const k of KPI) {
      expect(T.KPI_TESTI[k.id], k.id).toBeTruthy();
      expect(vietato(k.titolo), `${k.id}: ${k.titolo}`).toBeUndefined();
      expect(vietato(k.spiegazione), `${k.id}: ${k.spiegazione}`).toBeUndefined();
    }
  });
  it('componenti Direzione: nessuna chiave interna nel testo visibile (JSX e attributi)', () => {
    const files = ['direzione/Centralino.tsx', 'direzione/Panoramica.tsx', 'direzione/Feed.tsx', 'direzione/Digest.tsx', 'direzione/ReportDirezione.tsx', 'direzione/ShellDirezione.tsx', 'direzione/comuni.tsx', 'centralino/Analisi.tsx'];
    const errati: string[] = [];
    for (const f of files) {
      const src = readFileSync(resolve(__dirname, '..', f), 'utf8');
      const visibili = [
        ...[...src.matchAll(/>([^<>{}\n]*[A-Za-zÀ-ú][^<>{}\n]*)</g)].map(m => m[1]),
        ...[...src.matchAll(/(?:title|aria-label|titolo|sub|extra|label|l)=["']([^"']+)["']/g)].map(m => m[1]),
        ...[...src.matchAll(/\b(?:l|voce|titolo|descrizione|def|testo):\s*'([^']+)'/g)].map(m => m[1]),
      ];
      for (const s of visibili) { const v = vietato(s); if (v) errati.push(`${f}: «${s.trim()}» (${v})`); }
    }
    expect(errati).toEqual([]);
  });
  it('Report Direzione PDF (SQL 0100 da confermare): etichette chiare', () => {
    const sql = readFileSync(resolve(__dirname, '../../supabase/migrations/20261125_0100_report_direzione_offerte.sql'), 'utf8');
    const etichette = [...sql.matchAll(/'(?:label|titolo)',\s*'([^']+)'/g), ...sql.matchAll(/\(\d+,'([^']+)',array/g), ...sql.matchAll(/jsonb_build_array\('([^']+)',\s*'/g), ...sql.matchAll(/then '([^']+)'/g)].map(m => m[1]);
    expect(etichette.length).toBeGreaterThan(20);
    expect(etichette.filter(s => vietato(s))).toEqual([]);
    expect(etichette).toContain('Intervento tecnico');
    expect(etichette).toContain('Modifica dati o disdetta');
  });
});
