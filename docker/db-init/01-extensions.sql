-- Runs once, on first initialisation of an empty pgdata volume.
-- `vector` backs the memories table + its HNSW index (ARCHITECTURE.md §Memory).
CREATE EXTENSION IF NOT EXISTS vector;
-- pgcrypto supplies gen_random_uuid() for the uuid primary keys.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
