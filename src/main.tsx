import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import '@fontsource-variable/archivo/wdth.css';
import '@fontsource/ibm-plex-sans/latin-400.css';
import '@fontsource/ibm-plex-sans/latin-500.css';
import '@fontsource/ibm-plex-sans/latin-600.css';
import '@fontsource/ibm-plex-sans/latin-700.css';
import '@fontsource/ibm-plex-sans-arabic/arabic-400.css';
import '@fontsource/ibm-plex-sans-arabic/arabic-500.css';
import '@fontsource/ibm-plex-sans-arabic/arabic-600.css';
import '@fontsource/ibm-plex-sans-arabic/arabic-700.css';
import '@fontsource/jetbrains-mono/latin-500.css';
import '@fontsource/jetbrains-mono/latin-600.css';
import './styles.css';
import { configurato } from './lib/supabase';
import { LinguaProvider } from './lib/i18n';
import Shell from './admin/Shell';
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
import Report from './admin/Report';
import Volantino from './admin/Volantino';
import Avvisi from './admin/Avvisi';
import Tecnico from './tecnico/Tecnico';
import AreaAdmin from './admin/amm/AreaAdmin';
import Panoramica from './admin/amm/Panoramica';
import Account from './admin/amm/Account';
import Sicurezza from './admin/amm/Sicurezza';

function App() {
  if (!configurato) return <div className="wrap"><div className="banner ko">Configurazione mancante: VITE_SUPABASE_URL e VITE_SUPABASE_PUBLISHABLE_KEY.</div></div>;
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/t" element={<Tecnico />} />
        <Route path="/t/v/:qr" element={<Tecnico />} />
        <Route path="/t/scansiona" element={<Tecnico />} />
        <Route path="/t/elenco" element={<Tecnico />} />
        <Route path="/accesso" element={<Accesso />} />
        <Route element={<AreaAdmin />}>
          <Route path="/admin" element={<Panoramica />} />
          <Route path="/admin/account" element={<Account />} />
          <Route path="/admin/tecnici" element={<Tecnici />} />
          <Route path="/admin/installa-tecnici" element={<Volantino />} />
          <Route path="/admin/sicurezza" element={<Sicurezza />} />
          <Route path="/admin/registro" element={<Registro />} />
        </Route>
        <Route element={<Shell />}>
          <Route path="/cruscotto" element={<Cruscotto />} />
          <Route path="/piano" element={<Piano />} />
          <Route path="/flotta" element={<Flotta />} />
          <Route path="/stampa-qr" element={<StampaQr />} />
          <Route path="/tecnici" element={<Tecnici />} />
          <Route path="/segnalazioni" element={<Segnalazioni />} />
          <Route path="/registro" element={<Registro />} />
          <Route path="/multe" element={<Multe />} />
          <Route path="/carburante" element={<Carburante />} />
          <Route path="/report" element={<Report />} />
          <Route path="/installa-tecnici" element={<Volantino />} />
          <Route path="/avvisi" element={<Avvisi />} />
        </Route>
        <Route path="*" element={<Navigate to="/cruscotto" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><LinguaProvider><App /></LinguaProvider></React.StrictMode>);
