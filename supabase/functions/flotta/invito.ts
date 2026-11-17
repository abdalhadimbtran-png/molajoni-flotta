// Email d'invito e di reimpostazione password del Portale Molajoni (HTML + testo semplice).
// Nessuna password nell'email: solo il link sicuro per crearla.
const ROSSO = "#C8102E";
const SITO = "https://molajoni-flotta.vercel.app";
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

export type TipoEmail = "invito" | "recupero";
export type Saluto = "Benvenuta" | "Benvenuto" | "Benvenuta/o";

export const PANNELLI_NOMI: Record<string, string> = {
  admin: "Amministrazione", flotta: "Flotta", hr: "Ufficio personale",
  formazione: "Formazione", centralino: "Centralino", direzione: "Direzione",
};
export const PANNELLI_DESCR: Record<string, string> = {
  admin: "gestione completa del portale e degli account",
  flotta: "veicoli, pianificazione e dati dei tecnici",
  hr: "ferie, permessi e anagrafiche del personale",
  formazione: "corsi e attestati dei tecnici",
  centralino: "gestione delle richieste dei clienti",
  direzione: "riepiloghi e indicatori per la direzione",
};
const ORDINE = ["admin", "centralino", "formazione", "flotta", "hr", "direzione"];
const AZIENDA = "Molajoni Antincendi s.r.l.";

export function componiEmail(tipo: TipoEmail, o: { nome: string; email: string; link: string; saluto?: Saluto; pannelli?: string[]; firma?: string }) {
  const nome = o.nome.trim().split(/\s+/)[0] || o.nome;
  const firma = (o.firma ?? "").trim() || "Ufficio Operations";
  const chiavi = [...(o.pannelli ?? [])].sort((a, b) => (ORDINE.indexOf(a) + 99) % 99 - (ORDINE.indexOf(b) + 99) % 99);
  const aree = chiavi.map(p => ({ nome: PANNELLI_NOMI[p] ?? p, descr: PANNELLI_DESCR[p] ?? "" }));
  const invito = tipo === "invito";
  const oggetto = invito ? "Accesso al Portale Molajoni – credenziali personali" : "Portale Molajoni – reimpostazione della password";
  const titolo = invito ? `${o.saluto ?? "Benvenuta/o"} nel Portale Molajoni` : "Reimposta la tua password";
  const intro = invito
    ? "ti abbiamo attivato l'accesso personale al Portale Molajoni, lo strumento interno dell'azienda per il lavoro quotidiano."
    : "abbiamo ricevuto una richiesta di reimpostazione della password del tuo account sul Portale Molajoni.";
  const passi = invito
    ? ["Apri il link qui sotto e crea la tua password personale.", `Accedi da ${SITO}/accesso con la tua email aziendale (${o.email}).`]
    : ["Apri il link qui sotto e scegli una nuova password.", `Accedi da ${SITO}/accesso con la tua email aziendale (${o.email}).`];
  const etichettaLink = invito ? "Link per creare la password (personale, valido 24 ore):" : "Link per la nuova password (personale, valido 24 ore):";
  const chiusura = invito
    ? "Se il link è scaduto o hai bisogno di aiuto, rispondi a questa email."
    : "Se non hai richiesto tu la modifica, ignora questa email: la password attuale resta valida.";
  const riga = (a: { nome: string; descr: string }) => a.descr ? `${a.nome}: ${a.descr}` : a.nome;
  const testo = [
    `Ciao ${nome},`, "", intro, "",
    invito ? "Per iniziare:" : "Per procedere:",
    ...passi.map((p, i) => `${i + 1}. ${p}`), "",
    etichettaLink, o.link, "",
    ...(invito && aree.length ? ["Le aree a cui hai accesso:", ...aree.map(a => `– ${riga(a)}`), ""] : []),
    chiusura, "",
    "Buon lavoro,", firma, AZIENDA,
  ].join("\n");
  const html = `<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(titolo)}</title></head>
<body style="margin:0;background:#f3f1ee;font-family:Arial,Helvetica,sans-serif;color:#1a1a1a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:6px;overflow:hidden">
<tr><td style="background:${ROSSO};height:6px;line-height:6px;font-size:0">&nbsp;</td></tr>
<tr><td style="padding:28px 32px 8px"><img src="${SITO}/logo-molajoni.png" alt="Molajoni Antincendi" height="40" style="display:block;height:40px;border:0"></td></tr>
<tr><td style="padding:16px 32px 4px;font-size:22px;font-weight:700;letter-spacing:-.01em">${esc(titolo)}</td></tr>
<tr><td style="padding:8px 32px 0;font-size:15px;line-height:1.55;color:#333">
<p style="margin:0 0 14px">Ciao ${esc(nome)},<br>${esc(intro)}</p>
<p style="margin:0 0 6px"><b>${invito ? "Per iniziare:" : "Per procedere:"}</b></p>
<ol style="margin:0 0 18px;padding-left:20px">${passi.map(p => `<li style="margin:0 0 4px">${esc(p)}</li>`).join("")}</ol>
<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:4px;background:${ROSSO}">
<a href="${esc(o.link)}" style="display:inline-block;padding:13px 26px;color:#ffffff;text-decoration:none;font-weight:700;font-size:15px">${invito ? "Crea la tua password" : "Scegli la nuova password"}</a></td></tr></table>
<p style="margin:22px 0 0;font-size:13px;color:#6b6b6b">Il link è personale e vale 24 ore. Utente: <span style="color:#1a1a1a">${esc(o.email)}</span></p>
${invito && aree.length ? `<div style="margin:18px 0 0;padding:12px 14px;background:#faf7f5;border-left:3px solid ${ROSSO};font-size:14px;color:#444"><b style="color:#1a1a1a">Le aree a cui hai accesso</b>${aree.map(a => `<div style="margin-top:6px">– <b>${esc(a.nome)}</b>${a.descr ? `: ${esc(a.descr)}` : ""}</div>`).join("")}</div>` : ""}
<p style="margin:18px 0 0">${esc(chiusura)}</p>
<p style="margin:6px 0 0;font-size:12px;color:#8a8a8a;word-break:break-all">Se il pulsante non funziona, copia questo indirizzo nel browser:<br>${esc(o.link)}</p>
</td></tr>
<tr><td style="padding:28px 32px 28px"><div style="border-top:1px solid #ece8e4;padding-top:16px;font-size:13px;color:#555">
Buon lavoro,<br><b style="color:#1a1a1a">${esc(firma)}</b><br>${esc(AZIENDA)}<br><span style="color:${ROSSO};letter-spacing:.06em;font-size:11px;font-weight:700">DAL 1930</span></div></td></tr>
</table>
<p style="font-size:11px;color:#9a9a9a;margin:14px 0 0">Email automatica del Portale Molajoni · uso interno</p>
</td></tr></table></body></html>`;
  return { oggetto, testo, html };
}
