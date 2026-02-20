CREATE TYPE __SCHEMA__.user_role AS ENUM ('admin', 'member');

CREATE DOMAIN __SCHEMA__.email_address AS text
  CHECK (POSITION('@' IN VALUE) > 1);
