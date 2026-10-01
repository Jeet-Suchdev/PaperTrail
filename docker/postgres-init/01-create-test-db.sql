-- Runs once, on first container start (empty volume).
-- Integration tests use this database so they never touch dev data.
CREATE DATABASE papertrail_test;
