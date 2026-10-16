import { useState } from 'react';
import { Section } from '../components/ui';
import { meanAndSD } from '../lib/logic';
import { privacy, reports, type Report } from '../lib/stores';

const TYPES = ['Flood Condition Update', 'Evacuation Route Status', 'SOP 4 System Evaluation'];
const SCORES: [number, string][] = [
  [5, '5: Highly effective'],
  [4, '4: Effective'],
  [3, '3: Moderately effective'],
  [2, '2: Slightly effective'],
  [1, '1: Not effective'],
];

function interpret(mean: number) {
  if (mean >= 4.2) return 'Highly effective';
  if (mean >= 3.4) return 'Effective';
  if (mean >= 2.6) return 'Moderately effective';
  if (mean >= 1.8) return 'Slightly effective';
  return 'Not effective';
}

function PrivacyModal({ onAccept, onClose }: { onAccept: () => void; onClose: () => void }) {
  const [warn, setWarn] = useState(false);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/50 p-4" role="dialog" aria-modal="true" aria-labelledby="pm">
      <div className="w-full max-w-md rounded-xl bg-surface p-5">
        <p className="eyebrow">Republic Act No. 10173</p>
        <h2 id="pm" className="mt-1 text-lg font-semibold">Data privacy notice</h2>
        <div className="mt-3 max-h-56 space-y-2 overflow-y-auto rounded-lg bg-bg p-3 text-[13px] text-muted">
          <p>By sending a report you share your <strong className="text-ink">name, contact number, barangay and observation</strong> for community flood coordination.</p>
          <p>Under the Data Privacy Act of 2012 the data is used only for flood verification, coordination with CSJDM CDRRMO and First City Providential College, and system evaluation.</p>
          <p>Records are kept confidential and are not shared with unauthorised parties.</p>
        </div>
        {warn && <p className="mt-3 text-[13px] font-medium text-crit" role="alert">You need to accept before sending personal details.</p>}
        <div className="mt-4 flex gap-2">
          <button className="btn-primary flex-1" onClick={onAccept}>Accept and continue</button>
          <button className="btn-quiet" onClick={() => (warn ? onClose() : setWarn(true))}>Decline</button>
        </div>
      </div>
    </div>
  );
}

export default function Reports() {
  const list = reports.use();
  const consent = privacy.use();
  const [modal, setModal] = useState(false);
  const [pending, setPending] = useState<Report | null>(null);
  const [ok, setOk] = useState('');
  const [f, setF] = useState({ name: '', phone: '', area: 'Brgy. Narra, Francisco Homes, CSJDM', type: TYPES[0], rating: 5, message: '' });

  const evals = list.filter((r) => r.type === 'SOP 4 System Evaluation');
  const stats = meanAndSD(evals.map((r) => r.rating));

  function commit(r: Report) {
    reports.set((p) => [r, ...p]);
    setOk('Report sent. It now appears in the community feed.');
    setF({ ...f, name: '', phone: '', message: '' });
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const r: Report = { id: String(Date.now()), name: f.name, area: f.area, type: f.type, rating: f.rating, message: f.message, time: new Date().toLocaleString() };
    if (!consent.accepted) {
      setPending(r);
      setModal(true);
    } else commit(r);
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold sm:text-2xl">Community reports</h1>
        <p className="text-[13px] text-muted">Share street conditions or rate how the system performed.</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
        <Section title="Send a report" action={<button className="btn-quiet !min-h-9 text-xs" onClick={() => { setPending(null); setModal(true); }}>Privacy notice</button>}>
          <form onSubmit={submit} className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor="n">Full name</label>
                <input id="n" className="field" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoComplete="name" />
              </div>
              <div>
                <label className="label" htmlFor="p">Mobile number</label>
                <input id="p" className="field font-mono" type="tel" required placeholder="09XXXXXXXXX" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} autoComplete="tel" />
              </div>
            </div>
            <div>
              <label className="label" htmlFor="a">Barangay or sector</label>
              <input id="a" className="field" required value={f.area} onChange={(e) => setF({ ...f, area: e.target.value })} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor="t">Type</label>
                <select id="t" className="field" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
                  {TYPES.map((t) => <option key={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="r">System rating (SOP 4)</label>
                <select id="r" className="field" value={f.rating} onChange={(e) => setF({ ...f, rating: Number(e.target.value) })}>
                  {SCORES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="label" htmlFor="m">What are you seeing?</label>
              <textarea id="m" className="field" rows={4} required value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} placeholder="Water height on your street, route condition to FCPC, alarm response…" />
            </div>
            <button className="btn-primary w-full" type="submit">Send report</button>
            {ok && <p className="rounded-lg bg-safe-tint px-3 py-2 text-[13px] font-medium text-safe" role="status">{ok}</p>}
          </form>
        </Section>

        <div className="space-y-4">
          <Section title="SOP 4: system rating" hint="Weighted mean and standard deviation across respondents.">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg bg-bg p-3">
                <p className="eyebrow">Mean</p>
                <p className="tnum font-mono text-2xl font-semibold text-safe">{stats.mean.toFixed(2)}<span className="text-sm text-faint"> / 5</span></p>
                <p className="text-xs text-muted">{interpret(stats.mean)}</p>
              </div>
              <div className="rounded-lg bg-bg p-3">
                <p className="eyebrow">Std. deviation</p>
                <p className="tnum font-mono text-2xl font-semibold">±{stats.sd.toFixed(2)}</p>
                <p className="tnum font-mono text-xs text-muted">n = {stats.n}</p>
              </div>
            </div>
          </Section>

          <Section title="Recent reports">
            <ul className="space-y-2">
              {list.map((r) => (
                <li key={r.id} className="rounded-lg border border-line p-3 text-[13px]">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold">{r.name}</span>
                    <span className="tnum font-mono text-xs text-faint">{r.type === 'SOP 4 System Evaluation' ? `${r.rating}/5` : ''}</span>
                  </div>
                  <p className="text-xs text-faint">{r.area} · {r.type}</p>
                  <p className="mt-1.5 text-muted">{r.message}</p>
                </li>
              ))}
            </ul>
          </Section>
        </div>
      </div>

      {modal && (
        <PrivacyModal
          onClose={() => { setModal(false); setPending(null); }}
          onAccept={() => {
            privacy.set({ accepted: true });
            setModal(false);
            if (pending) commit(pending);
            setPending(null);
          }}
        />
      )}
    </div>
  );
}
