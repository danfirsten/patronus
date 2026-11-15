import { useEffect, useState } from 'react';
import DataChat, { CHAT_ROUTES } from './DataChat';

const route = () => window.location.hash.replace(/^#\/?/, '').split('?')[0].split('/').filter(Boolean).map(decodeURIComponent);

/**
 * Mounted once next to <App /> (main.tsx). Shows the floating chat only on data pages
 * (CHAT_ROUTES); hidden on the pitch landing and story pages, and while a dock chat is mounted.
 */
export default function ChatMount() {
  const [r, setR] = useState(route);
  useEffect(() => {
    const on = () => setR(route());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  if (!CHAT_ROUTES.includes(r[0] ?? '')) return null;
  return <DataChat mode="floating" page={r.slice(0, 2).join('/')} />;
}
