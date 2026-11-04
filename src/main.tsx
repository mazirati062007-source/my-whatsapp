import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App.tsx';
import './index.css';

// Регистрация Service Worker для автономной работы и установки приложения (PWA)
registerSW({
  immediate: true,
});

createRoot(document.getElementById('root')!).render(<App />);
