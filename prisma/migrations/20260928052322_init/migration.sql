-- Manual SQL (not expressible in the Prisma schema), see docs/architecture/database.md.
-- btree_gist backs the booking exclusion constraints that prevent double assignment
-- of a driver or a vehicle (ADR-0007). Additive and idempotent.
CREATE EXTENSION IF NOT EXISTS btree_gist;
