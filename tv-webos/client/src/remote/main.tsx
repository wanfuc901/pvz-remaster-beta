import { createRoot } from 'react-dom/client';
import { RemoteApp } from './RemoteApp';
import './remote.css';

createRoot(document.getElementById('root')!).render(<RemoteApp />);

// The service worker only registers on secure origins (HTTPS or localhost); on a plain-HTTP LAN it is skipped.
if ('serviceWorker' in navigator && window.isSecureContext) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./remote-sw.js').catch(() => undefined);
  });
}
