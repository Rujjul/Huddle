import { useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import './profile.css';
type Profile = { id: string; display_name: string; bio: string; interests: string[]; profile_completed_at?: string | null };
export function ProfileEditor({ csrf, onSave }: { csrf: string; onSave: (name: string) => void }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [options, setOptions] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError('');
    Promise.all(['/api/me/profile', '/api/interests'].map(async url => {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) throw new Error(response.status === 401 ? 'Please sign in again.' : 'Could not load your profile.');
      return response.json();
    })).then(([data, choices]) => { setProfile(data.profile); setOptions(choices.interests); })
      .catch(error => { if (!controller.signal.aborted) setError(error.message); });
    return () => controller.abort();
  }, [attempt]);
  async function save(event: FormEvent) {
    event.preventDefault(); if (!profile) return;
    setBusy(true); setError(''); setSaved(false);
    try {
      const response = await fetch('/api/me/profile', { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrf }, body: JSON.stringify({ display_name: profile.display_name, bio: profile.bio, interests: profile.interests }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not save your profile.');
      setProfile(data.profile); onSave(data.profile.display_name); setSaved(true);
    } catch (error) { setError(error instanceof Error ? error.message : 'Could not save. Please try again.'); }
    finally { setBusy(false); }
  }
  if (!profile) return <section className="profile-panel"><p role="status">{error || 'Loading your profile...'}</p>{error && <button onClick={() => setAttempt(n => n + 1)}>Try again</button>}</section>;
  return <section className="profile-panel"><div className="profile-heading"><div><span className="eyebrow">YOUR CORNER OF CAMPUS</span><h2>{profile.profile_completed_at ? 'Make yourself at home.' : 'First, a little about you.'}</h2><p>A name, a few interests, and a good place to start.</p></div><span className="profile-avatar" aria-hidden="true">{profile.display_name.trim().slice(0, 1).toUpperCase() || '?'}</span></div><form onSubmit={save} onChange={() => setSaved(false)}><fieldset disabled={busy}><label htmlFor="display-name">What should we call you?</label><input id="display-name" required maxLength={80} value={profile.display_name} onChange={event => setProfile({ ...profile, display_name: event.target.value })}/><label htmlFor="bio">A little about yourself <span>(optional)</span></label><textarea id="bio" rows={3} maxLength={500} placeholder="Usually up for a badminton game or a good coffee..." value={profile.bio} onChange={event => setProfile({ ...profile, bio: event.target.value })}/><small>{profile.bio.length}/500</small><fieldset className="interest-field"><legend>What are you into?</legend><p>Pick up to 8. You can change these anytime.</p><div className="interest-options">{options.map(interest => <label key={interest} className={profile.interests.includes(interest) ? 'selected' : ''}><input type="checkbox" checked={profile.interests.includes(interest)} disabled={!profile.interests.includes(interest) && profile.interests.length >= 8} onChange={event => setProfile({ ...profile, interests: event.target.checked ? [...profile.interests, interest] : profile.interests.filter(item => item !== interest) })}/>{interest}</label>)}</div><small>{profile.interests.length}/8 selected</small></fieldset><p className="privacy-note">Your name, bio, and interests are visible to signed-in campus members after you save. Your email stays private.</p>{error && <p role="alert" className="auth-error">{error}</p>}{saved && <p role="status" className="save-success">Profile saved. You're all set!</p>}<div className="profile-actions"><button className="button" type="submit">{busy ? 'Saving...' : profile.profile_completed_at ? 'Save changes' : 'Save my profile'}</button>{profile.profile_completed_at && <Link to={`/users/${profile.id}`}>View my campus profile ↗</Link>}</div></fieldset></form></section>;
}
export function PublicProfile() {
  const { id } = useParams();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController(); setProfile(null); setError('');
    fetch(`/api/users/${id}`, { signal: controller.signal }).then(async response => {
      const data = await response.json();
      if (!response.ok) throw new Error(response.status === 401 ? 'Sign in to view campus profiles.' : data.error || 'Unable to load profile.');
      setProfile(data.profile);
    }).catch(error => { if (!controller.signal.aborted) setError(error.message); });
    return () => controller.abort();
  }, [id]);
  return <main><Link to="/">← Back to Huddle</Link><section className="profile-panel public-profile">{profile ? <><span className="profile-avatar">{profile.display_name.slice(0, 1).toUpperCase()}</span><span className="eyebrow">VIT BHOPAL / CAMPUS MEMBER</span><h1>{profile.display_name}</h1><p className="profile-bio">{profile.bio || 'Still thinking of a good introduction.'}</p><h2>Interests</h2><div className="interest-options">{profile.interests.length ? profile.interests.map(interest => <span className="selected" key={interest}>{interest}</span>) : <p>No interests added yet.</p>}</div></> : <p role="status">{error || 'Loading profile...'}</p>}</section></main>;
}
