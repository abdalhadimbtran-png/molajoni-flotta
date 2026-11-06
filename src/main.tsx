import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import '@fontsource-variable/inter/opsz.css';
import '@fontsource/ibm-plex-sans-arabic/arabic-400.css';
import '@fontsource/ibm-plex-sans-arabic/arabic-500.css';
import '@fontsource/ibm-plex-sans-arabic/arabic-600.css';
import '@fontsource/ibm-plex-sans-arabic/arabic-700.css';
import '@fontsource/jetbrains-mono/latin-500.css';
import '@fontsource/jetbrains-mono/latin-600.css';
import './styles.css';
import './design/tokens.css';
import { configurato } from './lib/supabase';
import { LinguaProvider } from './lib/i18n';
import Shell, { Smistamento } from './admin/Shell';
import Accesso from './admin/Accesso';
import Cruscotto from './admin/Cruscotto';
import Piano from './admin/Piano';
import Flotta from './admin/Flotta';
import StampaQr from './admin/StampaQr';
import Tecnici from './admin/Tecnici';
import Segnalazioni from './admin/Segnalazioni';
import Registro from './admin/Registro';
import Multe from './admin/Multe';
import Carburante from './admin/Carburante';
import CarteCarburante from './admin/CarteCarburante';
import Report from './admin/Report';
import ElencoAttivita from './admin/ElencoAttivita';
import Volantino from './admin/Volantino';
import Avvisi from './admin/Avvisi';
import Percorsi from './admin/percorsi/Percorsi';
import Pianificatore from './admin/percorsi/Pianificatore';
import Interventi from './admin/interventi/Interventi';
import Giornata from './admin/giornata/Giornata';
import Tecnico from './tecnico/Tecnico';
import AreaAdmin from './admin/amm/AreaAdmin';
import Panoramica from './admin/amm/Panoramica';
import Account from './admin/amm/Account';
import Sicurezza from './admin/amm/Sicurezza';
import ShellHR from './hr/ShellHR';
import DaDecidere from './hr/DaDecidere';
import CalendarioHR from './hr/Calendario';
import Dipendenti from './hr/Dipendenti';
import Saldi from './hr/Saldi';
import Impostazioni from './hr/Impostazioni';
import ReportHR from './hr/ReportHR';
import SchedaAccesso from './hr/SchedaAccesso';
import ShellFormazione from './formazione/ShellFormazione';
import CruscottoFormazione from './formazione/Cruscotto';
import CorsiFormazione from './formazione/Corsi';
import DipendentiFormazione from './formazione/Dipendenti';
import RegistraFormazione from './formazione/Registra';
import ReportFormazione from './formazione/Report';
import ArchivioFormazione from './formazione/Archivio';
import ShellCentralino from './centralino/ShellCentralino';
import HomeCentralino from './centralino/Home';
import PraticheCentralino from './centralino/Pratiche';
import ModelliCentralino from './centralino/Modelli';
import ImpostazioniCentralino from './centralino/Impostazioni';
import ReportCentralino from './centralino/Report';
import Trasferimenti from './centralino/Trasferimento';
import DirezioneCentralino from './centralino/Direzione';
import AnalisiCentralino from './centralino/Analisi';
import ClientiCentralino from './centralino/Clienti';
import ReferentiCentralino from './centralino/Referenti';

function App() {
  if (!configurato) return <div className="wrap"><div className="banner ko">Configurazione mancante: VITE_SUPABASE_URL e VITE_SUPABASE_PUBLISHABLE_KEY.</div></div>;
  return (
    <BrowserRouter>
      <Routes>
        {/* App di tutti i dipendenti: /t, /t/v/:qr, /t/scansiona, /t/elenco, /t/ferie, /t/ferie/nuova, /t/ferie/:id, /t/profilo */}
        <Route path="/t/*" element={<Tecnico />} />
        <Route path="/ferie" element={<Navigate to="/t/ferie/nuova" replace />} />
        <Route path="/accesso" element={<Accesso />} />
        <Route element={<AreaAdmin />}>
          <Route path="/admin" element={<Panoramica />} />
          <Route path="/admin/account" element={<Account />} />
          <Route path="/admin/tecnici" element={<Tecnici />} />
          <Route path="/admin/installa-tecnici" element={<Volantino />} />
          <Route path="/admin/sicurezza" element={<Sicurezza />} />
          <Route path="/admin/registro" element={<Registro />} />
          <Route path="/admin/report" element={<Report />} />
        </Route>
        <Route element={<ShellHR />}>
          <Route path="/hr" element={<DaDecidere />} />
          <Route path="/hr/richieste" element={<DaDecidere />} />
          <Route path="/hr/calendario" element={<CalendarioHR />} />
          <Route path="/hr/dipendenti" element={<Dipendenti />} />
          <Route path="/hr/saldi" element={<Saldi />} />
          <Route path="/hr/impostazioni" element={<Impostazioni />} />
          <Route path="/hr/report" element={<ReportHR />} />
          <Route path="/hr/carte" element={<CarteCarburante gestione />} />
          <Route path="/hr/carburante" element={<Carburante gestione />} />
          <Route path="/hr/installa" element={<SchedaAccesso />} />
          <Route path="/hr/*" element={<Navigate to="/hr" replace />} />
        </Route>
        <Route element={<ShellFormazione />}>
          <Route path="/formazione" element={<CruscottoFormazione />} />
          <Route path="/formazione/dipendenti" element={<DipendentiFormazione />} />
          <Route path="/formazione/registra" element={<RegistraFormazione />} />
          <Route path="/formazione/corsi" element={<CorsiFormazione />} />
          <Route path="/formazione/report" element={<ReportFormazione />} />
          <Route path="/formazione/archivio" element={<ArchivioFormazione />} />
          <Route path="/formazione/*" element={<Navigate to="/formazione" replace />} />
        </Route>
        <Route element={<ShellCentralino />}>
          <Route path="/centralino" element={<HomeCentralino />} />
          <Route path="/centralino/pratiche" element={<PraticheCentralino />} />
          <Route path="/centralino/pratica/:id" element={<PraticheCentralino />} />
          <Route path="/centralino/trasferimenti" element={<Trasferimenti />} />
          <Route path="/centralino/modelli" element={<ModelliCentralino />} />
          <Route path="/centralino/impostazioni" element={<ImpostazioniCentralino />} />
          <Route path="/centralino/report" element={<ReportCentralino />} />
          <Route path="/centralino/analisi" element={<AnalisiCentralino />} />
          <Route path="/centralino/monitoraggio" element={<DirezioneCentralino />} />
          <Route path="/centralino/clienti" element={<ClientiCentralino />} />
          <Route path="/centralino/referenti" element={<ReferentiCentralino />} />
          <Route path="/centralino/nuovo" element={<HomeCentralino />} />
          <Route path="/centralino/*" element={<Navigate to="/centralino" replace />} />
          <Route path="/direzione/centralino" element={<DirezioneCentralino />} />
          <Route path="/direzione/centralino/pratica/:id" element={<PraticheCentralino />} />
          <Route path="/direzione/centralino/analisi" element={<AnalisiCentralino />} />
          <Route path="/direzione/*" element={<Navigate to="/direzione/centralino" replace />} />
        </Route>
        <Route element={<Shell />}>
          <Route path="/cruscotto" element={<Cruscotto />} />
          <Route path="/piano" element={<Piano />} />
          <Route path="/attivita" element={<ElencoAttivita />} />
          <Route path="/flotta" element={<Flotta />} />
          <Route path="/stampa-qr" element={<StampaQr />} />
          <Route path="/tecnici" element={<Tecnici />} />
          <Route path="/segnalazioni" element={<Segnalazioni />} />
          <Route path="/registro" element={<Registro />} />
          <Route path="/multe" element={<Multe />} />
          <Route path="/carburante" element={<Carburante />} />
          <Route path="/carte" element={<CarteCarburante />} />
          <Route path="/report" element={<Report />} />
          <Route path="/installa-tecnici" element={<Volantino />} />
          <Route path="/avvisi" element={<Avvisi />} />
          <Route path="/percorsi" element={<Percorsi />} />
          <Route path="/interventi" element={<Interventi />} />
          <Route path="/giornata" element={<Giornata />} />
          <Route path="/percorsi/nuovo" element={<Pianificatore />} />
          <Route path="/percorsi/:id" element={<Pianificatore />} />
        </Route>
        <Route path="/" element={<Smistamento />} />
        <Route path="*" element={<Smistamento />} />
      </Routes>
    </BrowserRouter>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><LinguaProvider><App /></LinguaProvider></React.StrictMode>);
