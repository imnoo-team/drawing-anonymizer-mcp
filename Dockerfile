# Runs the published drawing-anonymizer-mcp server over stdio.
# Used by Glama to verify the server starts and answers introspection.
# Node 22.13+ is required by pdfjs-dist 5; pdf.js renders through @napi-rs/canvas, which
# installs a prebuilt native binary, so no build tools are needed on this Debian-based image.
FROM node:22-slim

RUN npm install -g drawing-anonymizer-mcp@0.1.0

# stdio transport: the client speaks JSON-RPC over stdin/stdout.
ENTRYPOINT ["drawing-anonymizer-mcp"]
