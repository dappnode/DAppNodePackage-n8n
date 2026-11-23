#!/bin/sh
# Put back the database and encryption key restored from a DAppNode backup before n8n opens them
node /usr/local/lib/dappnode/backup.mjs import || exit 1

# Keep a consistent snapshot of the database and a copy of the encryption key for the DAppNode backup:
# one minute after start, then every 15 minutes if they changed. It keeps running in the background
# after exec, as a child of n8n.
(
  sleep 60
  while true; do
    node /usr/local/lib/dappnode/backup.mjs export
    sleep 900
  done
) &

exec /docker-entrypoint.sh "$@"
