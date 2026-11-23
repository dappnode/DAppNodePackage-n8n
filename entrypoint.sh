#!/bin/sh
# Starts as root to repair what a backup restore can leave behind, then runs n8n as the node user.
set -e

DATA=/home/node/.n8n
DB="$DATA/database.sqlite"
# Inode and ctime of database.sqlite at the last start, "none" if it did not exist (not backed up)
STATE="$DATA/.database-identity"

identity() { stat -c '%i %z' "$1" 2>/dev/null || echo none; }
# Files put back by a restore keep the mtime from the backup and get a new ctime, SQLite sets both when it writes
is_restored() { [ "$(stat -c %Y "$1")" -lt "$(stat -c %Z "$1")" ]; }

# A restore that puts back database.sqlite without database.sqlite-wal (a backup taken after a clean close)
# leaves the -wal of the replaced database next to it (n8n does not close its database on shutdown, so it
# always has one), and SQLite would apply it to the restored database. Only checked when database.sqlite was
# replaced since the last start, so a -wal that n8n wrote after a restore is kept.
if [ -f "$DB" ] && [ -f "$DB-wal" ] && [ -f "$STATE" ] && [ "$(identity "$DB")" != "$(cat "$STATE")" ] &&
  is_restored "$DB" && ! is_restored "$DB-wal"; then
  echo "[entrypoint] $DB was restored without its -wal, moving the -wal of the replaced database to $DB-wal.stale"
  mv -f "$DB-wal" "$DB-wal.stale"
fi

# The Backup tab of DAppManager versions without full backup restores files with `docker cp`, owned by root
find "$DATA" ! -user node -exec chown node:node {} +

identity "$DB" >"$STATE"
chown node:node "$STATE"

exec su -s /bin/sh node -c 'exec /docker-entrypoint.sh "$@"' n8n "$@"
