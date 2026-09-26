CREATE TABLE message_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id bigint NOT NULL UNIQUE REFERENCES activity_messages(id) ON DELETE CASCADE,
  filename varchar(180) NOT NULL,
  mime_type text NOT NULL CHECK (mime_type IN ('image/jpeg','image/png','image/webp','image/gif','video/mp4','video/webm','video/quicktime')),
  content bytea NOT NULL CHECK (octet_length(content) BETWEEN 1 AND 26214400),
  size integer NOT NULL CHECK (size = octet_length(content))
);
