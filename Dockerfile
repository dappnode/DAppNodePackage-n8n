ARG UPSTREAM_VERSION
FROM n8nio/n8n:${UPSTREAM_VERSION#n8n@}

COPY entrypoint.sh /usr/local/bin/dappnode-entrypoint.sh
# The entrypoint fixes the ownership of restored files as root, then runs n8n as node
USER root
ENTRYPOINT ["tini", "--", "/usr/local/bin/dappnode-entrypoint.sh"]
