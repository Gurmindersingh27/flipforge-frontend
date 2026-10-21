import { useEffect, useRef, useState } from 'react';
import { useAuth, SignInButton } from '@clerk/clerk-react';
import { getItemPreferences, putItemPreferences } from '../lib/api';
import { ITEM_LABELS } from '../lib/itemAnalysis';
import { buildPreferences, PREFERENCE_FIELDS, preferenceForm } from '../lib/itemPreferences';
import type { ItemPreferences } from '../lib/types';

type Props = { onResolved: (profile: ItemPreferences | null) => void; light?: boolean; disabled?: boolean };
export default function ItemPreferencesPanel(props: Props) {
  const { isLoaded, isSignedIn, userId } = useAuth();
  if (!isLoaded) return <p role="status">Loading buying preferences…</p>;
  if (!isSignedIn) return <details className={props.light ? 'quick-details' : 'rounded-xl border border-white/15 p-4'}>
    <summary>My buying preferences</summary><p>Sign in to remember preferences across devices.</p>
    <SignInButton mode="modal"><button type="button" className={props.light ? 'quick-secondary' : 'min-h-11 underline'}>Sign in for preferences</button></SignInButton>
  </details>;
  return <PreferencesEditor key={userId} {...props} />;
}
function PreferencesEditor({ onResolved, light, disabled }: Props) {
  const { getToken } = useAuth();
  const [form, setForm] = useState(() => preferenceForm(null));
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed' | 'continued'>('loading');
  const [attempt, setAttempt] = useState(0);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [saveFailed, setSaveFailed] = useState(false);
  const alive = useRef(false);
  const request = useRef<Promise<ItemPreferences | null> | null>(null);
  const resolved = useRef(false);
  const generation = useRef(0);
  const savingRef = useRef(false);
  useEffect(() => {
    let active = true;
    alive.current = true; const current = ++generation.current;
    request.current ??= (async () => {
      const token = await getToken();
      if (!alive.current) throw new Error('Account changed.');
      if (!token) throw new Error('Sign in again to load preferences.');
      return getItemPreferences(token);
    })();
    void request.current.then(profile => {
      if (!active) return;
      setForm(preferenceForm(profile)); setStatus('ready');
      if (!resolved.current) { resolved.current = true; onResolved(profile); }
    }).catch(() => { if (active) setStatus('failed'); });
    return () => { active = false; alive.current = false; generation.current = current + 1; };
  }, [getToken, onResolved, attempt]);
  async function save() {
    if (status !== 'ready' || savingRef.current || disabled) return;
    let payload;
    try { payload = buildPreferences(form); }
    catch (error) { setMessage((error as Error).message); return; }
    const current = generation.current;
    savingRef.current = true; setSaving(true); setMessage(''); setSaveFailed(false);
    try {
      const token = await getToken();
      if (current !== generation.current) return;
      if (!token) throw new Error('Sign in again.');
      const profile = await putItemPreferences(payload, token);
      if (current !== generation.current) return;
      setForm(preferenceForm(profile)); setMessage('Preferences saved for your next find. This find is unchanged.');
    } catch {
      if (current !== generation.current) return;
      setSaveFailed(true); setMessage('Save not confirmed. It may already have applied. Retrying replaces the whole set, including changes from another device.');
    } finally {
      if (current === generation.current) { savingRef.current = false; setSaving(false); }
    }
  }
  return <section aria-label="Buying preferences" className={light ? 'quick-card' : 'min-w-0 rounded-xl border border-white/15 bg-white/5 p-4 sm:p-6'}>
    {status === 'loading' && <p role="status">Loading buying preferences… You can choose photos while you wait.</p>}
    {(status === 'failed' || status === 'continued') && <div role="alert"><p>{status === 'continued' ? 'Retry loading to change your preferences.' : "Couldn't load your buying preferences."}</p>
      <button type="button" className={light ? 'quick-secondary' : 'min-h-11 px-3 underline'} onClick={() => { request.current = null; setStatus('loading'); setAttempt(n => n + 1); }}>Retry loading preferences</button>
      {status === 'failed' && <button type="button" className={light ? 'quick-text-button' : 'min-h-11 px-3 underline'} onClick={() => { resolved.current = true; onResolved(null); setStatus('continued'); }}>Continue without remembered preferences</button>}
    </div>}
    <details data-preferences-panel>
      <summary className="min-h-11 cursor-pointer py-2 font-semibold">My buying preferences</summary>
      <p className={light ? 'quick-small' : 'mt-2 text-sm text-white/70'}>Optional starting values for new finds. Blank stays unknown; 0 means none. Saving changes your next find, not this one or any saved estimate. The last save replaces the whole set across devices.</p>
      <fieldset disabled={status !== 'ready' || saving || disabled} className="min-w-0">
        <div className={light ? 'quick-fields' : 'mt-4 grid min-w-0 gap-4 sm:grid-cols-2'}>
          {PREFERENCE_FIELDS.map(key => <label key={key} className={light ? 'quick-field' : 'block min-w-0 text-sm'} htmlFor={`preference-${key}`}>{ITEM_LABELS[key]}
            <input id={`preference-${key}`} type="text" inputMode="decimal" autoComplete="off" placeholder="Unknown" value={form[key]}
              onChange={event => { setForm(old => ({ ...old, [key]: event.target.value })); setMessage(''); setSaveFailed(false); }}
              className={light ? undefined : 'mt-2 min-h-11 w-full min-w-0 rounded-lg border border-white/20 bg-black/20 px-3 py-2'} />
          </label>)}
        </div>
        <button type="button" onClick={() => void save()} className={light ? 'quick-secondary' : 'mt-4 min-h-11 rounded-lg border border-amber-300 px-4 py-2'}>{saving ? 'Saving preferences…' : saveFailed ? 'Retry saving preferences' : 'Save preferences'}</button>
      </fieldset>
      {message && <p role={saveFailed ? 'alert' : 'status'} className={light ? 'quick-small' : 'mt-3 text-sm'}>{message}</p>}
    </details>
  </section>;
}
