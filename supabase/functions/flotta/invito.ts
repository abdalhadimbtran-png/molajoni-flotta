// Email d'invito e di reimpostazione password del Portale Molajoni (HTML + testo semplice).
// Nessuna password nell'email: solo il link sicuro per crearla.
const ROSSO = "#C8102E";
const SITO = "https://molajoni-flotta.vercel.app";
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

export type TipoEmail = "invito" | "recupero";
export type Saluto = "Benvenuta" | "Benvenuto" | "Benvenuta/o";

export const PANNELLI_NOMI: Record<string, string> = {
  admin: "Amministrazione (tutto il portale)", flotta: "Flotta e pianificazione", hr: "Ufficio personale",
  formazione: "Formazione", centralino: "Centralino", direzione: "Direzione",
};

export function componiEmail(tipo: TipoEmail, o: { nome: string; email: string; link: string; saluto?: Saluto; pannelli?: string[] }) {
  const nome = o.nome.split(/\s+/)[0] || o.nome;
  const pann = (o.pannelli ?? []).map(p => PANNELLI_NOMI[p] ?? p);
  const invito = tipo === "invito";
  const oggetto = invito ? `${o.saluto ?? "Benvenuta/o"} nel Portale Molajoni` : "Reimposta la tua password · Portale Molajoni";
  const titolo = invito ? `${o.saluto ?? "Benvenuta/o"} nel Portale Molajoni` : "Reimposta la tua password";
  const intro = invito
    ? `Ciao ${nome}, è stato creato il tuo account personale sul Portale Molajoni.`
    : `Ciao ${nome}, abbiamo ricevuto una richiesta per reimpostare la password del tuo account sul Portale Molajoni.`;
  const passo = invito
    ? "Per iniziare, crea la tua password personale con il pulsante qui sotto. Poi potrai accedere in qualsiasi momento con la tua email aziendale."
    : "Scegli una nuova password con il pulsante qui sotto. Se non hai fatto tu la richiesta, ignora questa email: la password attuale resta valida.";
  const testo = [
    titolo, "", intro, "",
    ...(pann.length ? [`Accesso a: ${pann.join(", ")}`, ""] : []),
    passo, "", `Imposta la tua password: ${o.link}`, "",
    "Il link è personale e vale 24 ore. Dopo, chiedi un nuovo invito all'amministratore.",
    `Accesso al portale: ${SITO}/accesso · Utente: ${o.email}`, "",
    "Molajoni Antincendi", "dal 1930",
  ].join("\n");
  const html = `<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(oggetto)}</title></head>
<body style="margin:0;background:#f3f1ee;font-family:Arial,Helvetica,sans-serif;color:#1a1a1a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:6px;overflow:hidden">
<tr><td style="background:${ROSSO};height:6px;line-height:6px;font-size:0">&nbsp;</td></tr>
<tr><td style="padding:28px 32px 8px"><img src="${SITO}/logo-molajoni.png" alt="Molajoni Antincendi" height="40" style="display:block;height:40px;border:0"></td></tr>
<tr><td style="padding:16px 32px 4px;font-size:22px;font-weight:700;letter-spacing:-.01em">${esc(titolo)}</td></tr>
<tr><td style="padding:8px 32px 0;font-size:15px;line-height:1.55;color:#333">
<p style="margin:0 0 14px">${esc(intro)}</p>
${pann.length ? `<p style="margin:0 0 14px;padding:10px 14px;background:#faf7f5;border-left:3px solid ${ROSSO};font-size:14px;color:#444"><b>Accesso a:</b> ${esc(pann.join(" · "))}</p>` : ""}
<p style="margin:0 0 22px">${esc(passo)}</p>
<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:4px;background:${ROSSO}">
<a href="${esc(o.link)}" style="display:inline-block;padding:13px 26px;color:#ffffff;text-decoration:none;font-weight:700;font-size:15px">Imposta la tua password</a></td></tr></table>
<p style="margin:22px 0 0;font-size:13px;color:#6b6b6b">Il link è personale e vale 24 ore. Utente: <span style="color:#1a1a1a">${esc(o.email)}</span></p>
<p style="margin:6px 0 0;font-size:12px;color:#8a8a8a;word-break:break-all">Se il pulsante non funziona, copia questo indirizzo nel browser:<br>${esc(o.link)}</p>
</td></tr>
<tr><td style="padding:28px 32px 28px"><div style="border-top:1px solid #ece8e4;padding-top:16px;font-size:13px;color:#555">
<b style="color:#1a1a1a">Molajoni Antincendi</b><br><span style="color:${ROSSO};letter-spacing:.06em;font-size:11px;font-weight:700">DAL 1930</span></div></td></tr>
</table>
<p style="font-size:11px;color:#9a9a9a;margin:14px 0 0">Email automatica del Portale Molajoni · uso interno</p>
</td></tr></table></body></html>`;
  return { oggetto, testo, html };
}
