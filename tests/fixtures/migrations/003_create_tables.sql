CREATE TABLE __SCHEMA__.users (
  id SERIAL PRIMARY KEY,
  email __SCHEMA__.email_address NOT NULL UNIQUE,
  display_name text NOT NULL,
  role __SCHEMA__.user_role NOT NULL DEFAULT 'member'
);

CREATE TABLE __SCHEMA__.posts (
  id SERIAL PRIMARY KEY,
  user_id integer NOT NULL REFERENCES __SCHEMA__.users(id) ON DELETE CASCADE,
  title text NOT NULL
);
