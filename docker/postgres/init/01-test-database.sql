-- Runs once, on the first start of an empty volume.
-- Separate database for integration tests so they never touch development data.
CREATE DATABASE avelys_test OWNER avelys;
