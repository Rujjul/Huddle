CREATE TABLE activity_messages (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  activity_id uuid NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id),
  body text NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX activity_messages_history_idx ON activity_messages(activity_id, id DESC);
