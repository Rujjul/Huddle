export type AttachmentData = { id: string; filename: string; mime_type: string; size: number };
export function Attachment({ file }: { file: AttachmentData }) {
  const url = `/api/attachments/${file.id}`;
  return <figure className="chat-attachment">{file.mime_type.startsWith('image/') ? <a href={url} target="_blank" rel="noreferrer"><img src={url} alt={file.filename} loading="lazy"/></a> : <video src={url} controls preload="metadata" playsInline/>}<figcaption><a href={url} target="_blank" rel="noreferrer">{file.filename}</a> · {(file.size / 1024 / 1024).toFixed(1)} MB</figcaption></figure>;
}
