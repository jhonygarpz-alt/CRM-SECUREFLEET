import { createContext, useContext, useEffect, useState } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { api, getToken, setToken } from './api.js';
import Layout from './components/Layout.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Contacts from './pages/Contacts.jsx';
import ContactDetail from './pages/ContactDetail.jsx';
import Pipeline from './pages/Pipeline.jsx';
import Products from './pages/Products.jsx';
import Quotes from './pages/Quotes.jsx';
import QuoteEditor from './pages/QuoteEditor.jsx';
import Inbox from './pages/Inbox.jsx';
import Activities from './pages/Activities.jsx';
import Settings from './pages/Settings.jsx';
import { CampaignList, CampaignNew, CampaignDetail } from './pages/Campaigns.jsx';

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

const BrandContext = createContext({ name: 'SecureFleet', version: '0' });
export const useBrand = () => useContext(BrandContext);
export const logoUrl = (brand) => `/branding/logo?v=${brand.version}`;

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(Boolean(getToken()));
  const [brand, setBrand] = useState({ name: 'SecureFleet', tagline: '', version: '0' });
  const refreshBrand = () => fetch('/api/branding').then((r) => r.json()).then(setBrand).catch(() => {});
  useEffect(() => { refreshBrand(); }, []);
  useEffect(() => { document.title = `${brand.name} CRM`; }, [brand.name]);
  const location = useLocation();

  useEffect(() => {
    if (!getToken()) return;
    api('/auth/me').then(setUser).catch(() => setToken(null)).finally(() => setLoading(false));
  }, []);

  const login = (token, u) => { setToken(token); setUser(u); };
  const logout = () => { setToken(null); setUser(null); };

  if (loading) return <div className="center-screen">Cargando…</div>;

  return (
    <BrandContext.Provider value={{ ...brand, refresh: refreshBrand }}>
    <AuthContext.Provider value={{ user, login, logout }}>
      <Routes>
        <Route path="/login" element={user ? <Navigate to="/" /> : <Login />} />
        <Route element={user ? <Layout /> : <Navigate to="/login" state={{ from: location }} />}>
          <Route index element={<Dashboard />} />
          <Route path="contactos" element={<Contacts />} />
          <Route path="contactos/:id" element={<ContactDetail />} />
          <Route path="pipeline" element={<Pipeline />} />
          <Route path="whatsapp" element={<Inbox />} />
          <Route path="whatsapp/:contactId" element={<Inbox />} />
          <Route path="campanas" element={<CampaignList />} />
          <Route path="campanas/nueva" element={<CampaignNew />} />
          <Route path="campanas/:id" element={<CampaignDetail />} />
          <Route path="cotizaciones" element={<Quotes />} />
          <Route path="cotizaciones/nueva" element={<QuoteEditor />} />
          <Route path="cotizaciones/:id" element={<QuoteEditor />} />
          <Route path="catalogo" element={<Products />} />
          <Route path="seguimientos" element={<Activities />} />
          <Route path="configuracion" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Route>
      </Routes>
    </AuthContext.Provider>
    </BrandContext.Provider>
  );
}
