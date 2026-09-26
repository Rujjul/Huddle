import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Chat } from './Chat';
type Person = { id: string; display_name: string; joined_at: string };
export function Participants({ activityId, userId, csrf, capacity, active, onChange }: { activityId: string; userId: string; csrf: string; capacity: number; active: boolean; onChange: (count: number) => void }) {
  const [people, setPeople] = useState<Person[]>([]), [hostId, setHostId] = useState('');
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError('');
    fetch(`/api/activities/${activityId}/participants`, { signal: controller.signal }).then(async response => { const data = await response.json(); if (!response.ok) throw new Error(data.error); setPeople(data.participants); setHostId(data.hostId); })
      .catch(error => { if (!controller.signal.aborted) setError(error.message || 'Could not load participants.'); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [activityId, attempt]);
  const joined = people.some(person => person.id === userId), host = hostId === userId;
  async function change() {
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await fetch(`/api/activities/${activityId}/${joined ? 'participants/me' : 'join'}`, { method: joined ? 'DELETE' : 'POST', headers: { 'x-csrf-token': csrf } });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not update participation.');
      setNotice(joined ? 'You have left the activity.' : "You're in! See you there.");
      const updated = await fetch(`/api/activities/${activityId}/participants`);
      if (!updated.ok) throw new Error('Participation saved. Refresh the list to see the latest people.');
      const next = await updated.json(); setPeople(next.participants); onChange(next.participants.length);
    } catch (error) { setError((error as Error).message); } finally { setBusy(false); }
  }
  return <section className="participants"><h2>Who's coming?</h2>{loading ? <p role="status">Loading participants...</p> : <><p>{people.length} of {capacity} places filled, including the host.</p>{host ? <p>You are hosting this activity.</p> : <button className="button" disabled={busy || (!joined && (!active || people.length >= capacity)) || !hostId} onClick={change}>{busy ? 'Updating...' : joined ? 'Leave activity' : !active ? 'Joining closed' : people.length >= capacity ? 'Activity full' : 'Join activity'}</button>}{notice && <p role="status">{notice}</p>}{error && <p role="alert" className="auth-error">{error}</p>}<button className="refresh-people" disabled={busy} onClick={() => setAttempt(n => n + 1)}>Refresh people</button><ul className="participant-list">{people.map(person => <li key={person.id}><Link to={`/users/${person.id}`}><span className="person-avatar" aria-hidden="true">{person.display_name.slice(0,1).toUpperCase()}</span>{person.display_name}</Link>{person.id === hostId && <span className="pill">Host</span>}{person.id === userId && <span className="pill">You</span>}</li>)}</ul>{!people.length && !error && <p>No participants yet.</p>}</>}{!loading && (joined || host) && <Chat activityId={activityId} userId={userId} csrf={csrf}/>}</section>;
}
