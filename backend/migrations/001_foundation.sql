CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  google_id text NOT NULL UNIQUE,
  email text NOT NULL UNIQUE,
  display_name varchar(80) NOT NULL,
  bio varchar(500) NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE user_interests (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  interest varchar(40) NOT NULL,
  PRIMARY KEY (user_id, interest)
);
CREATE TABLE activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id uuid NOT NULL REFERENCES users(id),
  title varchar(120) NOT NULL,
  description varchar(2000) NOT NULL DEFAULT '',
  category varchar(40) NOT NULL,
  location varchar(200) NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  capacity integer NOT NULL CHECK (capacity BETWEEN 1 AND 500),
  canceled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);
CREATE INDEX activities_discovery_idx ON activities(starts_at, id) WHERE canceled_at IS NULL;
-- The host will be inserted as a participant and counts toward capacity.
CREATE TABLE activity_participants (
  activity_id uuid NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (activity_id, user_id)
);
