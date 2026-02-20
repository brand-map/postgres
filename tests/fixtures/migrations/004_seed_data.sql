INSERT INTO __SCHEMA__.users (email, display_name, role)
VALUES
  ('alice@example.com', 'Alice', 'admin'),
  ('bob@example.com', 'Bob', 'member');

INSERT INTO __SCHEMA__.posts (user_id, title)
VALUES
  (1, 'Post 1'),
  (2, 'Post 2');
