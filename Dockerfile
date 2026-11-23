ARG UPSTREAM_VERSION
FROM n8nio/n8n:${UPSTREAM_VERSION#n8n@}

# The image user is root (see below), so `docker exec <container> n8n ...` runs as root, whose home
# is /root: without this, n8n CLI commands would read and write an empty /root/.n8n instead of the data volume
ENV N8N_USER_FOLDER=/home/node

COPY entrypoint.sh /usr/local/bin/dappnode-entrypoint.sh
# The entrypoint fixes the ownership of restored files as root, then runs n8n as node
USER root
ENTRYPOINT ["tini", "--", "/usr/local/bin/dappnode-entrypoint.sh"]
