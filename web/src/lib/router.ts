import { useEffect, useState } from 'react';

/** Tiny hash router: '#/country/ECU' -> ['country', 'ECU']. Works from static files. */
function parse(): string[] {
  const h = window.location.hash.replace(/^#\/?/, '');
  const path = h.split('?')[0];
  return path.split('/').filter(Boolean).map(decodeURIComponent);
}

export function useRoute(): string[] {
  const [route, setRoute] = useState(parse);
  useEffect(() => {
    const on = () => {
      setRoute(parse());
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

export const href = (...parts: string[]) => '#/' + parts.map(encodeURIComponent).join('/');
