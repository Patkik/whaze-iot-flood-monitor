import { useEffect, useRef, useState } from 'react';
import { Icon, Section, levelLabel } from '../components/ui';
import { startSiren } from '../lib/audio';
import { HOTLINES } from '../lib/geo';
import {
  addEmergencyContact,
  emergencyContactsStore,
  getPlatformCapabilities,
  locationStore,
  permissionsStore,
  pickContactFromDevice,
  removeEmergencyContact,
  requestContactsPermission,
  resolveActiveLocation,
  setLocationTrackingMode,
} from '../lib/platform';
import { checklist, sosLog, telemetry } from '../lib/stores';

const ZONES = [
  'Phase G3, Francisco Homes 1, Brgy. Yakal',
  'Brgy. Narra, near FCPC',
  'Francisco Ave. / D. Silang St.',
  'Creek-adjacent block, CSJDM',
];
const PRIORITIES = [
  'Priority 1: urgent evacuation, rising water',
  'Priority 2: senior, PWD or child extraction',
  'Priority 3: medical or first aid',
  'Status: checked in safe at FCPC',
];
const TASKS = [
  'Pack a 72-hour go-bag: water, food, flashlight, charged power bank.',
  'Seal medicines, first-aid supplies and IDs in a waterproof pouch.',
  'Switch off the main breaker, LPG valve and water valve.',
  'Lift electronics and appliances above the ground-floor flood line.',
  'Account for everyone: children, seniors and pets.',
  'Walk the elevated route: Phase G3, Francisco Ave., FCPC.',
];

function Siren() {
  const [on, setOn] = useState(false);
  const stop = useRef<null | (() => void)>(null);
  useEffect(() => () => stop.current?.(), []);
  function toggle() {
    if (on) {
      stop.current?.();
      stop.current = null;
    } else stop.current = startSiren();
    setOn(!on);
  }
  return (
    <section className={`card flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between ${on ? 'border-crit' : ''}`}>
      <div>
        <h2 className="text-[15px] font-semibold">Household siren</h2>
        <p className="text-[13px] text-muted">Alternating 880 / 1320 Hz tone to alert family and nearby rescuers.</p>
      </div>
      <button className={on ? 'btn-quiet' : 'btn-danger'} onClick={toggle} aria-pressed={on}>
        <Icon name="speaker" /> {on ? 'Stop siren' : 'Sound siren'}
      </button>
    </section>
  );
}

function Sos() {
  const t = telemetry.use();
  const log = sosLog.use();
  const loc = locationStore.use();
  const contacts = emergencyContactsStore.use();
  const [zone, setZone] = useState(ZONES[0]);
  const [count, setCount] = useState(4);
  const [priority, setPriority] = useState(PRIORITIES[0]);
  const [notes, setNotes] = useState('');
  const [recipientPhone, setRecipientPhone] = useState('+639175550101');
  const [done, setDone] = useState('');

  const activeLoc = resolveActiveLocation(loc);
  const coordsStr = `${activeLoc.coords[0].toFixed(5)}, ${activeLoc.coords[1].toFixed(5)}`;
  const mapUrl = `https://maps.google.com/?q=${activeLoc.coords[0].toFixed(5)},${activeLoc.coords[1].toFixed(5)}`;

  const water = `${t.waterCm.toFixed(1)} cm (${levelLabel[t.status]})`;
  const body = `WHAZE SOS FLOOD ALERT\nZone: ${zone}\nCoords (${activeLoc.isLiveGps ? 'Live GPS' : 'Custom Pin'}): ${coordsStr}\nMap: ${mapUrl}\nHousehold: ${count}\nPriority: ${priority}\nWater: ${water}\nNotes: ${notes || 'none'}\nTime: ${new Date().toLocaleString()}`;
  const smsHref = `sms:${recipientPhone}?body=${encodeURIComponent(body)}`;

  function save() {
    sosLog.set((p) => [
      {
        id: String(Date.now()),
        time: new Date().toLocaleString(),
        zone: `${zone} (${activeLoc.isLiveGps ? 'GPS' : 'Custom'}: ${coordsStr})`,
        household: count,
        priority,
        water,
        notes,
      },
      ...p,
    ].slice(0, 20));
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    save();
    setDone('Saved on this device. Tap Send SMS to transmit it to responders or selected contact.');
  }

  return (
    <Section title="SOS broadcast" hint="Includes your zone, GPS/custom coordinates, household size and live water level (RA 10639).">
      {/* Inline GPS vs Custom Location Switch for SOS */}
      <div className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-line bg-bg px-3 py-2">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-ink">
            {loc.trackMyLocation ? 'Using Live GPS Coordinates' : 'Using Custom Pin Coordinates'}
          </p>
          <p className="tnum font-mono text-[11px] text-muted truncate">
            {coordsStr} · {activeLoc.label}
          </p>
        </div>
        <label className="relative inline-flex cursor-pointer items-center shrink-0">
          <input
            type="checkbox"
            checked={loc.trackMyLocation}
            onChange={(e) => void setLocationTrackingMode(e.target.checked)}
            className="peer sr-only"
          />
          <div className="peer h-5 w-9 rounded-full bg-line peer-checked:bg-brand peer-focus:outline-none after:absolute after:top-[2px] after:left-[2px] after:h-4 after:w-4 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all after:content-[''] peer-checked:after:translate-x-full peer-checked:after:border-white"></div>
        </label>
      </div>

      <form onSubmit={submit} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
          <div>
            <label className="label" htmlFor="zone">Location zone</label>
            <select id="zone" className="field" value={zone} onChange={(e) => setZone(e.target.value)}>
              {ZONES.map((z) => <option key={z}>{z}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="count">People in household</label>
            <input id="count" className="field font-mono" type="number" min={1} max={30} value={count} onChange={(e) => setCount(Math.max(1, Number(e.target.value) || 1))} />
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
          <div>
            <label className="label" htmlFor="prio">Priority</label>
            <select id="prio" className="field" value={priority} onChange={(e) => setPriority(e.target.value)}>
              {PRIORITIES.map((z) => <option key={z}>{z}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="water">Sensor reading</label>
            <input id="water" className="field font-mono" value={water} readOnly />
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="recipient">Send SOS recipient</label>
            <select
              id="recipient"
              className="field"
              value={recipientPhone}
              onChange={(e) => setRecipientPhone(e.target.value)}
            >
              {contacts.map((c) => (
                <option key={c.id} value={c.phone}>
                  {c.name} ({c.phone})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="notes">Landmark or access notes</label>
            <input id="notes" className="field" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Corner house, 2nd floor" />
          </div>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <button type="submit" className="btn-quiet flex-1">Save dispatch</button>
          <a href={smsHref} className="btn-danger flex-1" onClick={() => { save(); setDone('Dispatch saved and SMS opened.'); }}>
            <Icon name="send" /> Send SMS
          </a>
        </div>
        {done && <p className="rounded-lg bg-safe-tint px-3 py-2 text-[13px] font-medium text-safe" role="status">{done}</p>}
      </form>

      {log.length > 0 && (
        <div className="mt-5 border-t border-line pt-4">
          <p className="eyebrow mb-2">Saved dispatches</p>
          <ul className="space-y-2">
            {log.map((r) => (
              <li key={r.id} className="rounded-lg bg-bg p-3 text-[13px]">
                <p className="font-semibold">{r.zone}</p>
                <p className="text-muted">{r.priority}</p>
                <p className="tnum font-mono text-xs text-faint">{r.time} · {r.household} people · {r.water}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Section>
  );
}

function EmergencyContactsSection() {
  const contacts = emergencyContactsStore.use();
  const perms = permissionsStore.use();
  const caps = getPlatformCapabilities();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [relation, setRelation] = useState('Family');
  const [statusMsg, setStatusMsg] = useState('');

  async function handleGrantAndPick() {
    setStatusMsg('Requesting Contacts permission…');
    try {
      const picked = await pickContactFromDevice();
      if (picked && (picked.name || picked.phone)) {
        addEmergencyContact({
          name: picked.name,
          phone: picked.phone,
          relation: 'Phonebook Contact',
        });
        setStatusMsg(`Imported ${picked.name} (${picked.phone}) from your contacts.`);
      } else {
        setStatusMsg('No contact selected.');
      }
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : 'Unable to pick contact from device.');
    }
  }

  async function handleRequestPermOnly() {
    const ok = await requestContactsPermission();
    setStatusMsg(
      ok
        ? 'Contacts permission granted! You can now import or add emergency contacts.'
        : 'Contacts permission was denied. You can still add contacts manually below.',
    );
  }

  function handleAddManual(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !phone.trim()) return;
    addEmergencyContact({ name, phone, relation });
    setName('');
    setPhone('');
    setStatusMsg(`Added ${name.trim()} to your emergency contacts.`);
  }

  return (
    <Section
      title="Emergency contacts"
      hint="Grant Contacts permission to import family or household numbers for quick SOS alerts."
      action={
        <span
          className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
            perms.contacts === 'granted'
              ? 'bg-safe-tint text-safe'
              : perms.contacts === 'denied'
              ? 'bg-crit-tint text-crit'
              : 'bg-bg text-muted'
          }`}
        >
          Contacts: {perms.contacts === 'granted' ? 'Granted' : perms.contacts === 'denied' ? 'Denied' : 'Permission'}
        </span>
      }
    >
      <div className="mb-3 flex flex-wrap gap-2">
        {perms.contacts !== 'granted' && (
          <button
            type="button"
            className="btn-quiet !min-h-9 text-xs"
            onClick={() => void handleRequestPermOnly()}
          >
            <Icon name="users" size={14} /> Grant Contacts Permission
          </button>
        )}
        <button
          type="button"
          className="btn-primary !min-h-9 text-xs"
          onClick={() => void handleGrantAndPick()}
        >
          <Icon name="users" size={14} />{' '}
          {caps.isNative ? 'Pick from Android Contacts' : 'Import from Device Contacts'}
        </button>
      </div>

      {statusMsg && (
        <p className="mb-3 rounded-lg bg-bg px-3 py-2 text-xs text-muted" role="status">
          {statusMsg}
        </p>
      )}

      <form onSubmit={handleAddManual} className="mb-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
        <input
          className="field text-xs"
          placeholder="Contact name (e.g. Maria Santos)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
        <input
          className="field font-mono text-xs"
          placeholder="Mobile number (09XXXXXXXXX)"
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          required
        />
        <button type="submit" className="btn-quiet !min-h-10 text-xs">
          + Add
        </button>
      </form>

      <ul className="divide-y divide-line rounded-lg border border-line">
        {contacts.map((c) => (
          <li key={c.id} className="flex items-center justify-between gap-2 px-3 py-2.5 text-xs">
            <div className="min-w-0">
              <p className="font-semibold text-ink truncate">{c.name}</p>
              <p className="tnum font-mono text-[11px] text-muted">
                {c.phone} · {c.relation}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <a
                href={`tel:${c.phone}`}
                className="btn-quiet !min-h-8 !px-2.5 text-xs"
                aria-label={`Call ${c.name}`}
              >
                <Icon name="phone" size={13} />
              </a>
              {c.id !== 'default-cdrrmo' && (
                <button
                  type="button"
                  className="btn-quiet !min-h-8 !px-2 text-xs text-crit"
                  onClick={() => removeEmergencyContact(c.id)}
                  aria-label={`Remove ${c.name}`}
                >
                  <Icon name="close" size={13} />
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </Section>
  );
}

export default function Emergency() {
  const done = checklist.use();
  const count = TASKS.filter((_, i) => done[i]).length;
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold sm:text-2xl">Emergency</h1>
        <p className="text-[13px] text-muted">Call for help, send your location, and get ready to leave.</p>
      </div>
      <Siren />
      <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
        <div className="space-y-4">
          <Sos />
          <EmergencyContactsSection />
        </div>
        <div className="space-y-4">
          <Section title="Hotlines" hint="Tap to call.">
            <ul className="divide-y divide-line rounded-lg border border-line">
              {HOTLINES.map((h) => (
                <li key={h.name}>
                  <a href={`tel:${h.tel}`} className="flex min-h-14 items-center justify-between gap-3 px-3 py-2 hover:bg-bg">
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold">{h.name}</span>
                      <span className="block truncate text-xs text-muted">{h.detail}</span>
                    </span>
                    <span className={`tnum flex shrink-0 items-center gap-2 rounded-lg px-3 py-1.5 font-mono text-[13px] font-semibold ${h.urgent ? 'bg-crit text-white' : 'bg-brand-tint text-brand'}`}>
                      <Icon name="phone" size={14} /> {h.label}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </Section>

          <Section title="Before you leave" action={<span className="tnum rounded-full bg-bg px-2.5 py-0.5 font-mono text-xs font-semibold text-muted">{count} / {TASKS.length}</span>}>
            <ul className="space-y-2">
              {TASKS.map((task, i) => (
                <li key={task}>
                  <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-line p-3 text-[13px] has-checked:border-green-200 has-checked:bg-safe-tint">
                    <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-green-700" checked={!!done[i]} onChange={(e) => checklist.set({ ...done, [i]: e.target.checked })} />
                    <span className={done[i] ? 'text-muted line-through' : ''}>{task}</span>
                  </label>
                </li>
              ))}
            </ul>
          </Section>
        </div>
      </div>
    </div>
  );
}
