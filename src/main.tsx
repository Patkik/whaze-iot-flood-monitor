import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Route, Routes, Navigate } from 'react-router-dom';
import { registerSW } from 'virtual:pwa-register';
import './index.css';
import Shell from './components/Shell';
import Monitor from './pages/Monitor';
import Evacuate from './pages/Evacuate';
import Emergency from './pages/Emergency';
import Reports from './pages/Reports';
import { bindAudioUnlock } from './lib/audio';

bindAudioUnlock();
registerSW({ immediate: true });

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route element={<Shell />}>
          <Route index element={<Monitor />} />
          <Route path="evacuate" element={<Evacuate />} />
          <Route path="emergency" element={<Emergency />} />
          <Route path="reports" element={<Reports />} />
          <Route path="routes" element={<Navigate to="/evacuate" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
);
