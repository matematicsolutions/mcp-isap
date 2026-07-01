# Dockerfile — lets Glama (or any sandbox) build and introspect this MCP server.
# The server is published on npm; this installs it and runs its stdio entrypoint.
FROM node:20-slim
RUN npm install -g @matematicsolutions/mcp-isap
ENTRYPOINT ["mcp-isap"]
