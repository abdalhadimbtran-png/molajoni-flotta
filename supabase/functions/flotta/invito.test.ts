import { describe, expect, it } from "vitest";
import { componiEmail } from "./invito.ts";

const base = { nome: "Jennifer Marchetti", email: "j.marchetti@molajoni.it", link: "https://molajoni-flotta.vercel.app/imposta-password?th=abc&t=invite" };

describe("componiEmail", () => {
  it("invito: oggetto, aree ordinate, firma admin, niente markdown", () => {
    const c = componiEmail("invito", { ...base, saluto: "Benvenuta", pannelli: ["flotta", "formazione", "centralino"], firma: "Hadi" });
    expect(c.oggetto).toBe("Accesso al Portale Molajoni – credenziali personali");
    expect(c.testo.startsWith("Ciao Jennifer,")).toBe(true);
    expect(c.testo).toContain("– Centralino: gestione delle richieste dei clienti\n– Formazione");
    expect(c.testo).toContain("Buon lavoro,\nHadi\nMolajoni Antincendi s.r.l.");
    expect(c.testo).not.toMatch(/[*#`]/);
    expect(c.testo.length).toBeLessThan(1500);
    expect(c.html).toContain("Benvenuta nel Portale Molajoni");
  });
  it("recupero: firma predefinita e nessun elenco aree", () => {
    const c = componiEmail("recupero", { ...base, pannelli: ["flotta"] });
    expect(c.testo).toContain("Ufficio Operations");
    expect(c.testo).not.toContain("Le aree");
  });
});
