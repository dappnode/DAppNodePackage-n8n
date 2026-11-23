ARG UPSTREAM_VERSION
FROM n8nio/n8n:${UPSTREAM_VERSION#n8n@}

COPY backup.mjs /usr/local/lib/dappnode/backup.mjs
COPY entrypoint.sh /usr/local/bin/dappnode-entrypoint.sh
ENTRYPOINT ["tini", "--", "/usr/local/bin/dappnode-entrypoint.sh"]
