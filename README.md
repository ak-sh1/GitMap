# GitMap

A codebase explorer built with **React, TypeScript, and Flask**. Import a public GitHub repository or a ZIP, explore its dependency graph, and read source.

## What works

- Public GitHub imports, including a selected branch. File reads are pinned to the imported commit.
- Local ZIP imports. Files remain in tab memory; archives are not uploaded.
- Expandable file explorer, path filtering, and a keyboard file finder.
- Interactive dependency graph with draggable files, directional import connections, pan, zoom, and automatic layout.
- Focus on a file's immediate dependencies and dependents; collapse folders into aggregate nodes.
- Impact view for tracing direct and indirect dependents through scanned imports.
- Source code and relationship notes alongside the graph, with line references for imports.
- Source highlighting, Markdown preview, copying, and file downloads.
- Source-derived outlines, imports, symbol navigation, and file details.
- A complete example repository, available without network access.

The graph is built from **static imports**. JavaScript and TypeScript are parsed with Babel; Python imports are tokenized with support for comments, strings, aliases, multiline statements, package imports, and relative levels. The resolver supports local files, index files, TypeScript extension substitution, and explicitly configured paths/baseUrl in JSONC tsconfig/jsconfig files. It does not infer runtime dependencies, variable imports, inherited configuration, arbitrary bundler aliases, or function call graphs. External and unresolved imports are listed separately from local graph connections. Browser symbol outlines use lightweight declaration matching; Flask's `/api/outline` uses Python's AST.

The layout groups circular imports into the same dependency layer. Small graphs flow top to bottom, wider graphs flow left to right, and unconnected files appear separately below. Drag a node to adjust its position. Arrow direction is importer to imported file. Selecting a node colors outgoing imports copper and incoming imports blue. Grouped edges retain counts and provenance; double-clicking a folder expands it.

## Start the full React + Flask application

Requirements: Node.js 20.19+ (or 22.12+) and Python 3.11+.

```bash
npm install
python -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt
cp .env.example .env
```

On Windows, activate with `.venv\Scripts\activate`.

Set this in `.env` to route the frontend through Flask:

```dotenv
VITE_API_BASE_URL=http://localhost:5001
```

Start Flask in one terminal:

```bash
python -m backend.app
```

Start React in another:

```bash
npm run dev
```

Open `http://localhost:5173`.

## Browser-only mode

Leave `VITE_API_BASE_URL` empty. The React application fetches public repository metadata and source directly from GitHub. The hosted version uses this mode. ZIP files are read in the browser.

## Production Flask deployment

```bash
npm run build
gunicorn --bind 127.0.0.1:5001 backend.app:app
```

To serve the frontend and API from the same Flask origin, build with `VITE_API_BASE_URL=/` (normalized to a same-origin base by the client). Put the server behind a reverse proxy as appropriate. Configure `GITMAP_ALLOWED_ORIGINS` with comma-separated frontend origins if hosting them separately. The API rejects unrecognized browser origins. This is a personal developer tool, not a multi-tenant hosted service.

## Limits

GitHub's unauthenticated API limit applies. Set `GITHUB_TOKEN` on Flask to increase your available limit, or use a ZIP. The explorer accepts up to 12,000 tree entries; GitHub partial-tree responses are clearly labeled. Graph scanning processes 160 source files at a time with four concurrent reads and reuses the file cache. Choose Scan more to include another batch. Progress, failed reads, and parse errors are shown explicitly. ZIP uploads are limited to 20 MB compressed and 15 MB of included source, with a 400 KB limit per file. Dependency folders, credentials-like paths, binary files, and build output are excluded. These filters are a convenience and do not replace reviewing a project before sharing it with an external service.

Source files and workspace state are held in tab memory. Closing or refreshing the page resets the workspace.

## Tests

```bash
npm test
python -m pytest backend/test_app.py -q
npm run build
```

Tests cover tree construction, source analysis, relative imports, repository URL validation, unsafe paths, API errors, source snapshot pinning, and request limits. GitHub requests are mocked in unit tests.

## Structure

```text
src/
  components/       Explorer, map, source viewer, and dialogs
  api.ts            Browser and Flask API transports
  core.ts           Tree construction and source outlines
  example.ts        Bundled Fieldnotes example repository
  App.tsx           Workspace and navigation
backend/
  app.py            Flask application and endpoints
  test_app.py       API tests
```

GitMap is an independent implementation inspired by the GitWiz project described in a résumé.
