# syntax=docker/dockerfile-upstream:master
ARG UPSTREAM_VERSION
# Strip "n8n:" prefix if present to get just the version number
FROM n8nio/n8n:${UPSTREAM_VERSION#n8n:}
