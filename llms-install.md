# Installing the Drawing Anonymizer MCP server

Instructions for AI agents (Cline, Claude, Cursor, …) setting this server up for a user.

**Nothing needs to be cloned, built or configured.** The server is published on npm and runs with `npx`; it needs no API key and no environment variables.

## Requirements

- Node.js **22.13 or newer** (`node --version`). If it is older, ask the user to update Node.js first.

## Add the server

Add this entry to the client's MCP settings file (for Cline: `cline_mcp_settings.json`, opened from *MCP Servers → Configure MCP Servers*). Keep any servers already listed there.

```json
{
  "mcpServers": {
    "drawing-anonymizer": {
      "command": "npx",
      "args": ["-y", "drawing-anonymizer-mcp"]
    }
  }
}
```

The first start can take up to a minute while `npx` downloads the package.

## Check it works

The server must show as connected with four tools:

- `analyze_drawing` — upload a drawing PDF to Imnoo's drawing analysis and list the sensitive data found
- `load_analysis` — re-open a saved analysis JSON offline
- `review_masking` — preview what the masked drawing will hide and what stays visible
- `mask_drawing` — write the masked, flattened PDF (optionally an expiring share link)

There is also an `anonymize-drawing` prompt for the guided flow.

## Notes for the user

- `analyze_drawing` uploads the PDF to Imnoo's drawing analysis: 1 free analysis per day per IP address; uploads are deleted automatically within 24 hours. Masking runs locally and is unlimited.
- Optional: `DRAWING_ANONYMIZER_URL` points the server at another deployment of the web app. Leave it unset for normal use.
