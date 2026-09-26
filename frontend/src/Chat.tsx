import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { io } from 'socket.io-client';
import './chat.css';
import { Attachment, type AttachmentData } from './Attachment';
type Message = { id: string; body: string; created_at: string; user_id: string; display_name: string; attachment?: AttachmentData | null };
export function Chat({ activityId, userId, csrf }: { activityId: string; userId: string; csrf: string }) {
  const [messages, setMessages] = useState<Message[]>([]), [body, setBody] = useState(''), [error, setError] = useState('');
  const [loading, setLoading] = useState(true), [sending, setSending] = useState(false), [olderLoading, setOlderLoading] = useState(false), [more, setMore] = useState(false), [readOnly, setReadOnly] = useState(false), [live, setLive] = useState(false);
  const sequence = useRef(0), mounted = useRef(false);
  const [file, setFile] = useState<File | null>(null), [preview, setPreview] = useState('');
  const picker = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!file) { setPreview(''); return; }
    const url = URL.createObjectURL(file); setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  function chooseFile(selected?: File) {
    setError('');
    if (!selected) return;
    if (!['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/webm','video/quicktime'].includes(selected.type)) { setError('Choose a JPEG, PNG, WebP, GIF, MP4, WebM, or MOV file.'); if (picker.current) picker.current.value = ''; return; }
    if (selected.size > (selected.type.startsWith('image/') ? 10 : 25) * 1024 * 1024) { setError('Photos can be up to 10 MB; videos up to 25 MB.'); if (picker.current) picker.current.value = ''; return; }
    setFile(selected);
  }
  const load = useCallback(async (before?: string) => {
    const current = ++sequence.current;
    try {
      const response = await fetch(`/api/activities/${activityId}/messages${before ? `?before=${before}` : ''}`);
      const data = await response.json();
      if (!mounted.current || current !== sequence.current) return;
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) { setMessages([]); setReadOnly(true); setMore(false); }
        throw new Error(data.error || 'Could not load messages.');
      }
      setMessages(previous => before ? [...data.messages, ...previous].filter((message, index, all) => all.findIndex(item => item.id === message.id) === index) : data.messages);
      setMore(data.hasMore); setReadOnly(data.readOnly); setError('');
    } catch (error) { if (mounted.current && current === sequence.current) setError((error as Error).message); }
    finally { if (mounted.current && current === sequence.current) { setLoading(false); setOlderLoading(false); } }
  }, [activityId]);
  useEffect(() => {
    mounted.current = true; setLoading(true); void load();
    const socket = io({ transports: ['websocket'], reconnection: true });
    socket.on('connect', () => socket.timeout(5000).emit('watch', activityId, (error: Error | null, result: { ok: boolean }) => { if (mounted.current) { setLive(!error && result?.ok === true); void load(); } }));
    socket.on('messages-changed', () => { void load(); });
    socket.on('access-revoked', () => { setMessages([]); setReadOnly(true); setMore(false); setError('You are no longer a participant in this activity.'); socket.disconnect(); });
    socket.on('disconnect', () => setLive(false));
    socket.on('connect_error', () => setLive(false));
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 15000);
    return () => { mounted.current = false; sequence.current++; clearInterval(timer); socket.disconnect(); };
  }, [activityId, load]);
  async function send(event: FormEvent) {
    event.preventDefault(); if ((!body.trim() && !file) || sending) return;
    setSending(true); setError('');
    try {
      const form = new FormData();
      if (file) { form.append('file', file); form.append('body', body.trim()); }
      const response = await fetch(`/api/activities/${activityId}/${file ? 'attachments' : 'messages'}`, { method: 'POST', headers: file ? { 'x-csrf-token': csrf } : { 'Content-Type': 'application/json', 'x-csrf-token': csrf }, body: file ? form : JSON.stringify({ body: body.trim() }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Message was not sent.');
      setBody(''); setFile(null); if (picker.current) picker.current.value = ''; await load();
    } catch (error) { setError((error as Error).message); } finally { setSending(false); }
  }
  return <section className="chat-panel" aria-labelledby="chat-title"><div className="chat-heading"><h2 id="chat-title">The group chat</h2><span className="pill">{live ? 'Live' : 'Reconnecting · refresh available'}</span></div><p className="privacy-note">Only the host and current participants can read this conversation.</p><button type="button" disabled={loading || olderLoading} onClick={() => void load()}>Refresh messages</button>{loading ? <p role="status">Loading the conversation...</p> : <>{more && <button type="button" disabled={olderLoading} onClick={() => { setOlderLoading(true); void load(messages[0]?.id); }}>{olderLoading ? 'Loading...' : 'Load older messages'}</button>}<ol className="chat-messages" aria-label="Messages">{messages.map(message => <li key={message.id} className={message.user_id === userId ? 'my-message' : ''}><div><strong>{message.user_id === userId ? 'You' : message.display_name}</strong><time dateTime={message.created_at}>{new Date(message.created_at).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })}</time></div><p>{message.body}</p>{message.attachment && <Attachment file={message.attachment}/>}</li>)}</ol>{!messages.length && !error && <p>Start the conversation. Say hello or share the plan.</p>}</>}<details className="shared-attachments"><summary>Shared photos &amp; videos ({messages.filter(message => message.attachment).length})</summary><p>Attachments from the loaded conversation. Load older messages to see earlier files.</p><div className="attachment-gallery">{messages.filter(message => message.attachment).map(message => <Attachment key={message.id} file={message.attachment!}/>)}</div>{!messages.some(message => message.attachment) && <p>No photos or videos shared yet.</p>}</details>{error && <p className="auth-error" role="alert">{error}</p>}{readOnly ? <p>Chat is read-only or no longer available to your account.</p> : <form onSubmit={send}><label htmlFor="message-body">Your message</label><textarea id="message-body" maxLength={2000} value={body} disabled={sending} onChange={event => setBody(event.target.value)} placeholder="Say hello to the group..." rows={3}/><div className="attachment-picker"><label htmlFor="chat-file">Attach a photo or video</label><input ref={picker} id="chat-file" type="file" accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime" disabled={sending} onChange={event => chooseFile(event.target.files?.[0])}/><p>One file per message. Photos up to 10 MB, videos up to 25 MB.</p>{file && <div className="attachment-preview">{file.type.startsWith("image/") ? <img src={preview} alt="Selected attachment preview"/> : <video src={preview} controls preload="metadata"/>}<p>{file.name}</p><button type="button" disabled={sending} onClick={() => { setFile(null); if (picker.current) picker.current.value = ""; }}>Remove attachment</button></div>}</div><div className="chat-compose-footer"><small>{body.length}/2000</small><button className="button" disabled={sending || (!body.trim() && !file)}>{sending ? (file ? 'Uploading...' : 'Sending...') : 'Send message'}</button></div></form>}</section>;
}
