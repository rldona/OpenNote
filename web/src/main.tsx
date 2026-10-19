import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { applySavedPrefs } from './prefs';
import './styles.css';

applySavedPrefs();

const render = () =>
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );

if (__STANDALONE__) {
  // No server: start the in-browser database first, then show the app.
  void import('./standalone/boot')
    .then((m) => m.bootStandalone())
    .then(render)
    .catch((err: Error) => {
      document.getElementById('root')!.textContent = `OpenNote could not start: ${err.message}`;
    });
} else {
  render();
  // Installable app shell (not in dev, where Vite serves modules directly).
  if (import.meta.env.PROD && 'serviceWorker' in navigator && location.protocol.startsWith('http')) {
    window.addEventListener('load', () => void navigator.serviceWorker.register('/sw.js').catch(() => undefined));
  }
}
