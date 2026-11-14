import { createContext, useContext } from 'react';
import { ReportContext } from '../data/load';

/** Set of data files that came from fixtures on the current page. */
export const SampleContext = createContext<Set<string>>(new Set());

export function SampleBanner({ files }: { files: Map<string, { source: string; reason?: string }> }) {
  const sample = [...files.entries()].filter(([, v]) => v.source === 'fixture');
  const missing = [...files.entries()].filter(([, v]) => v.source === 'missing');
  if (!sample.length && !missing.length) return null;
  return (
    <div className="sample-banner" role="status">
      <strong>Sample data: pipeline output not loaded.</strong>{' '}
      {sample.length > 0 && (
        <>
          Numbers on this page from{' '}
          {sample.map(([f], i) => (
            <span key={f}>
              <code>{f}</code>
              {i < sample.length - 1 ? ', ' : ''}
            </span>
          ))}{' '}
          are illustrative placeholders, not results. Do not cite them.
        </>
      )}
      {missing.length > 0 && (
        <> Not available yet: {missing.map(([f]) => f).join(', ')}.</>
      )}
    </div>
  );
}

export const useReport = () => useContext(ReportContext);
