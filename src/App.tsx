import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Check,
  ChevronRight,
  CircleHelp,
  Code2,
  Copy,
  FileCode2,
  FolderOpen,
  GitBranch,
  Github,
  ListTree,
  Loader2,
  Network,
  PanelLeft,
  Search,
  Upload,
  X,
} from "lucide-react";
import { importGithub, importZip, readFile } from "./api";
import Explorer, { FileIcon } from "./components/Explorer";
import FileRelations from "./components/FileRelations";
import Modal from "./components/Modal";
import SourceViewer from "./components/SourceViewer";
import { analyzeFile, buildTree, flattenTree, language } from "./core";
import { isSource } from "./dependencies";
import { exampleRepository } from "./example";
import type { Repository, TreeNode } from "./types";
import useDependencyIndex from "./useDependencyIndex";

const DependencyMap = lazy(() => import("./components/DependencyMap"));
const exampleFile = "app/services/books.py";

function startingFile(repo: Repository) {
  if (repo.source === "example") return exampleFile;
  const files = repo.entries.filter((entry) => entry.type === "file");
  const sources = files.filter((entry) => isSource(entry.path));
  const projectSources = sources.filter(
    ({ path }) => !/(^|\/)(docs?|tests?|examples?|scripts?)(\/|$)/i.test(path),
  );
  const entryPoint = projectSources.find(({ path }) =>
    /(^|\/)(main|index|app|__main__)\.[^.]+$/i.test(path),
  );
  const packageEntry = projectSources.find(({ path }) =>
    /(^|\/)__init__\.py$/.test(path),
  );
  return (
    (
      entryPoint ??
      packageEntry ??
      projectSources[0] ??
      sources[0] ??
      files.find((entry) => /(^|\/)readme\.md$/i.test(entry.path)) ??
      files[0]
    )?.path ?? ""
  );
}

function parentFolders(path: string) {
  const parts = path.split("/");
  return parts
    .slice(0, -1)
    .map((_, index) => parts.slice(0, index + 1).join("/"));
}

type FileRead = { key: string; content: string; error: string };

export default function App() {
  const [repo, setRepo] = useState(exampleRepository);
  const [selected, setSelected] = useState(exampleFile);
  const [expanded, setExpanded] = useState(
    () => new Set(parentFolders(exampleFile)),
  );
  const [query, setQuery] = useState("");
  const [view, setView] = useState<"graph" | "files">("graph");
  const [treeOpen, setTreeOpen] = useState(false);
  const [inspector, setInspector] = useState<"outline" | "source" | null>(null);
  const [fileRead, setFileRead] = useState<FileRead | null>(null);
  const [activeLine, setActiveLine] = useState<number | null>(null);
  const [renderMarkdown, setRenderMarkdown] = useState(true);
  const [copiedPath, setCopiedPath] = useState("");
  const [notice, setNotice] = useState("");
  const [modal, setModal] = useState<"import" | "help" | "search" | null>(null);
  const [paletteQuery, setPaletteQuery] = useState("");
  const [importTab, setImportTab] = useState<"github" | "zip">("github");
  const [repoUrl, setRepoUrl] = useState("");
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState("");
  const zipInput = useRef<HTMLInputElement>(null);
  const importAbort = useRef<AbortController | null>(null);
  const cache = useRef(new Map<string, string>());
  const index = useDependencyIndex(repo, cache);
  const root = useMemo(() => buildTree(repo.entries), [repo.entries]);
  const nodes = useMemo(() => flattenTree(root), [root]);
  const byPath = useMemo(
    () => new Map(nodes.map((node) => [node.path, node])),
    [nodes],
  );
  const fileCount = useMemo(
    () => nodes.filter((node) => node.type === "file").length,
    [nodes],
  );
  const node = byPath.get(selected);
  const file = node?.type === "file" ? node : undefined;
  const fileKey = `${repo.id}:${selected}`;
  const currentRead = fileRead?.key === fileKey ? fileRead : null;
  const content = currentRead?.content ?? file?.content ?? "";
  const loading = !!file && !currentRead && file.content === undefined;
  const error = currentRead?.error ?? "";
  const outline = useMemo(
    () =>
      inspector === "outline" && file ? analyzeFile(file.path, content) : null,
    [content, file, inspector],
  );
  const paletteFiles =
    modal === "search"
      ? nodes
          .filter(
            (n) =>
              n.type === "file" &&
              n.path.toLowerCase().includes(paletteQuery.trim().toLowerCase()),
          )
          .slice(0, 50)
      : [];

  useEffect(() => {
    if (!file) return;
    const cached = cache.current.get(fileKey) ?? file.content;
    if (cached !== undefined) {
      setFileRead({ key: fileKey, content: cached, error: "" });
      return;
    }
    const controller = new AbortController();
    readFile(repo, file, controller.signal).then(
      (text) => {
        if (controller.signal.aborted) return;
        cache.current.set(fileKey, text);
        setFileRead({ key: fileKey, content: text, error: "" });
      },
      (error: Error) => {
        if (!controller.signal.aborted)
          setFileRead({ key: fileKey, content: "", error: error.message });
      },
    );
    return () => controller.abort();
  }, [file, fileKey, repo]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === "k" &&
        modal !== "import"
      ) {
        event.preventDefault();
        setPaletteQuery("");
        setModal((current) => (current === "search" ? null : "search"));
      }
      if (modal || event.defaultPrevented) return;
      if (
        event.key === "/" &&
        !(
          event.target instanceof HTMLElement &&
          (event.target.matches("input, textarea") ||
            event.target.isContentEditable)
        )
      ) {
        const filter = document.querySelector<HTMLInputElement>(
          view === "graph" ? ".graph-search input" : ".file-search input",
        );
        if (filter && filter.offsetWidth) {
          event.preventDefault();
          filter.focus();
        }
      }
      if (
        event.key === "Escape" &&
        !(
          CSS.supports("selector(:popover-open)") &&
          document.querySelector(":popover-open")
        )
      ) {
        setInspector(null);
        if (window.matchMedia("(max-width: 680px)").matches) setTreeOpen(false);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [modal, view]);

  useEffect(() => {
    if (!notice && !copiedPath) return;
    const timeout = window.setTimeout(() => {
      setNotice("");
      setCopiedPath("");
    }, 2400);
    return () => window.clearTimeout(timeout);
  }, [notice, copiedPath]);

  useEffect(() => () => importAbort.current?.abort(), []);

  function select(next: TreeNode) {
    if (next.path !== selected) setRenderMarkdown(true);
    setSelected(next.path);
    setActiveLine(null);
    setExpanded((open) => new Set([...open, ...parentFolders(next.path)]));
    if (
      view === "files" &&
      next.type === "file" &&
      window.matchMedia("(max-width: 680px)").matches
    )
      setTreeOpen(false);
  }

  function selectPath(path: string) {
    const next = byPath.get(path);
    if (next) select(next);
  }

  function changeView(next: "graph" | "files") {
    if (view === next) return;
    setView(next);
    setInspector(null);
    setTreeOpen(
      next === "files" && !window.matchMedia("(max-width: 680px)").matches,
    );
  }

  function openInFiles(next: TreeNode) {
    select(next);
    changeView("files");
    setModal(null);
  }

  function applyRepo(next: Repository) {
    const path = startingFile(next);
    cache.current.clear();
    setRepo(next);
    setSelected(path);
    setExpanded(new Set(parentFolders(path)));
    setQuery("");
    setView("graph");
    setTreeOpen(false);
    setInspector(null);
    setFileRead(null);
    setActiveLine(null);
    setRenderMarkdown(true);
    setCopiedPath("");
    setModal(null);
    setImportError("");
  }

  function closeModal() {
    importAbort.current?.abort();
    setImporting(false);
    setModal(null);
  }

  async function openRepository(
    load: (signal: AbortSignal) => Promise<Repository>,
  ) {
    if (importing) return;
    const controller = new AbortController();
    importAbort.current = controller;
    setImporting(true);
    setImportError("");
    try {
      const next = await load(controller.signal);
      if (!controller.signal.aborted) applyRepo(next);
    } catch (error) {
      if (!controller.signal.aborted) setImportError((error as Error).message);
    } finally {
      if (!controller.signal.aborted) setImporting(false);
    }
  }

  function loadZip(file?: File) {
    if (file) void openRepository(() => importZip(file));
  }

  function jumpTo(line: number) {
    setActiveLine(line);
    setRenderMarkdown(false);
    if (view === "graph") setInspector("source");
    else setInspector(null);
    requestAnimationFrame(() =>
      document
        .getElementById(
          `${view === "graph" ? "inspector-line-" : "line-"}${line}`,
        )
        ?.scrollIntoView({ block: "center" }),
    );
  }

  async function copySource() {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedPath(fileKey);
    } catch {
      setNotice("Clipboard access is unavailable.");
    }
  }

  function downloadSource() {
    if (!file) return;
    const link = document.createElement("a");
    const url = URL.createObjectURL(
      new Blob([content], { type: "text/plain" }),
    );
    link.href = url;
    link.download = file.name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const source = {
    node,
    content,
    loading,
    error,
    renderMarkdown,
    activeLine,
    onSelect: select,
  };
  const markdown = file?.name.toLowerCase().endsWith(".md");

  return (
    <div className="app">
      <header className="masthead">
        <div className="wordmark">
          <Network size={22} aria-hidden="true" />
          <span>GitMap</span>
        </div>
        <nav className="workspace-tabs" aria-label="Workspace">
          <button
            onClick={() => changeView("graph")}
            aria-pressed={view === "graph"}
          >
            <Network size={15} /> Graph
          </button>
          <button
            onClick={() => changeView("files")}
            aria-pressed={view === "files"}
          >
            <FolderOpen size={15} /> Files
          </button>
        </nav>
        <div className="header-actions">
          <button
            className="icon-button header-find"
            onClick={() => {
              setPaletteQuery("");
              setModal("search");
            }}
            aria-label="Find a file"
            title="Find a file (Ctrl or Cmd + K)"
          >
            <Search size={18} />
          </button>
          <button
            className="icon-button header-help"
            onClick={() => setModal("help")}
            aria-label="Help"
            title="Help"
          >
            <CircleHelp size={18} />
          </button>
          <button
            className="open-button"
            onClick={() => {
              setImportError("");
              setModal("import");
            }}
            aria-label="Open repository"
          >
            <FolderOpen size={16} /> <span>Open repository</span>
          </button>
        </div>
      </header>
      <div className="repo-strip">
        <span className="repo-location" title={`${repo.owner}/${repo.name}`}>
          <span>{repo.owner}</span>
          <span className="slash">/</span>
          <strong>{repo.name}</strong>
        </span>
        <span className="repo-branch" title={repo.branch}>
          <GitBranch size={13} /> <span>{repo.branch}</span>
        </span>
        {repo.source === "example" ? (
          <span className="repo-tag">Example</span>
        ) : null}
        {repo.source === "zip" ? (
          <span className="repo-tag">Local ZIP</span>
        ) : null}
        {repo.url ? (
          <a
            className="icon-button"
            href={repo.url}
            target="_blank"
            rel="noreferrer"
            aria-label="Open on GitHub"
            title="Open on GitHub"
          >
            <ArrowUpRight size={15} />
          </a>
        ) : null}
        <span className="repo-count">
          {fileCount} {fileCount === 1 ? "file" : "files"}
        </span>
      </div>
      {repo.warning ? (
        <div className="repo-warning" role="status">
          {repo.warning}
          <button
            className="icon-button"
            aria-label="Dismiss notice"
            onClick={() =>
              setRepo((current) => ({ ...current, warning: undefined }))
            }
          >
            <X size={15} />
          </button>
        </div>
      ) : null}

      <main className={`workspace ${view}-workspace`}>
        {view === "graph" ? (
          <Suspense
            fallback={
              <div className="empty-view" role="status">
                <Loader2 className="spin" size={22} /> Loading graph…
              </div>
            }
          >
            <DependencyMap
              key={repo.id}
              graph={index.graph}
              selected={selected}
              detailsOpen={inspector !== null}
              loading={index.loading}
              done={index.done}
              total={index.total}
              failed={index.failed}
              onContinue={index.continueScan}
              onRetry={index.retry}
              onSelect={selectPath}
              onToggleDetails={() => setInspector(inspector ? null : "outline")}
              onOpenDetails={() =>
                setInspector((current) => current ?? "outline")
              }
              onOpenSource={() => setInspector("source")}
            />
          </Suspense>
        ) : (
          <>
            {treeOpen ? (
              <aside
                className="file-sidebar"
                id="repository-files"
                aria-label="File explorer"
              >
                <Explorer
                  root={root}
                  selected={selected}
                  expanded={expanded}
                  query={query}
                  onQuery={setQuery}
                  onSelect={select}
                  onToggle={(path) =>
                    setExpanded((open) => {
                      const next = new Set(open);
                      if (next.has(path)) next.delete(path);
                      else next.add(path);
                      return next;
                    })
                  }
                  onCollapse={() => setExpanded(new Set())}
                />
              </aside>
            ) : null}
            <section className="source-pane" aria-label="Source reader">
              <div className="reader-bar">
                <button
                  className="icon-button"
                  aria-label="Toggle file explorer"
                  aria-expanded={treeOpen}
                  onClick={() => setTreeOpen(!treeOpen)}
                >
                  <PanelLeft size={17} />
                </button>
                <span className="reader-path" title={node?.path}>
                  {node ? <FileIcon name={node.name} /> : null}
                  <span>{node?.path ?? "Select a file"}</span>
                </span>
                {file ? (
                  <div className="reader-actions">
                    {markdown ? (
                      <button
                        className="icon-button"
                        aria-label={
                          renderMarkdown
                            ? "Show source"
                            : "Show Markdown preview"
                        }
                        onClick={() => setRenderMarkdown(!renderMarkdown)}
                      >
                        {renderMarkdown ? (
                          <Code2 size={17} />
                        ) : (
                          <BookOpen size={17} />
                        )}
                      </button>
                    ) : null}
                    <button
                      className="icon-button"
                      title="Copy source"
                      aria-label="Copy source"
                      onClick={copySource}
                      disabled={loading || !!error}
                    >
                      {copiedPath === fileKey ? (
                        <Check size={17} />
                      ) : (
                        <Copy size={17} />
                      )}
                    </button>
                    <button
                      className="icon-button"
                      title="Download file"
                      aria-label="Download file"
                      onClick={downloadSource}
                      disabled={loading || !!error}
                    >
                      <ArrowDownToLine size={17} />
                    </button>
                    <button
                      className="icon-button"
                      title="Outline"
                      aria-label="Outline"
                      aria-pressed={inspector === "outline"}
                      onClick={() => setInspector(inspector ? null : "outline")}
                    >
                      <ListTree size={17} />
                    </button>
                  </div>
                ) : null}
              </div>
              <SourceViewer key={selected} {...source} />
            </section>
          </>
        )}

        {inspector ? (
          <aside
            className="inspector"
            id="file-inspector"
            aria-label="File inspector"
          >
            <div className="inspector-header">
              <FileCode2 size={19} />
              <div>
                <h2 title={node?.name}>{node?.name ?? "File details"}</h2>
                {node ? <span title={node.path}>{node.path}</span> : null}
              </div>
              <button
                className="icon-button"
                onClick={() => setInspector(null)}
                aria-label="Close file inspector"
              >
                <X size={18} />
              </button>
            </div>
            {view === "graph" ? (
              <div
                className="inspector-tabs"
                role="group"
                aria-label="File inspector view"
              >
                <button
                  aria-pressed={inspector === "outline"}
                  onClick={() => setInspector("outline")}
                >
                  Outline
                </button>
                <button
                  aria-pressed={inspector === "source"}
                  onClick={() => setInspector("source")}
                >
                  Source
                </button>
                {node ? (
                  <button
                    className="open-in-files"
                    onClick={() => openInFiles(node)}
                  >
                    Open in Files <ArrowUpRight size={14} />
                  </button>
                ) : null}
              </div>
            ) : null}
            {inspector === "source" ? (
              <SourceViewer
                key={selected}
                {...source}
                renderMarkdown={false}
                linePrefix="inspector-line-"
              />
            ) : (
              <div className="inspector-outline">
                {file ? (
                  <>
                    <p className="source-meta">
                      {language(file.path)}
                      {outline && !loading && !error
                        ? ` · ${outline.lines} lines`
                        : ""}
                    </p>
                    <FileRelations
                      graph={index.graph}
                      selected={selected}
                      onSelect={selectPath}
                    />
                    <section
                      className="note-section"
                      aria-labelledby="symbols-heading"
                    >
                      <div className="note-section-title">
                        <h3 id="symbols-heading">Symbols</h3>
                        <span>{outline?.symbols.length ?? 0}</span>
                      </div>
                      {loading || error || !outline?.symbols.length ? (
                        <p className="muted small">
                          {loading
                            ? "Reading source…"
                            : error || "No declarations found."}
                        </p>
                      ) : (
                        <div className="symbols">
                          {outline.symbols.map((symbol) => (
                            <button
                              key={`${symbol.line}:${symbol.name}`}
                              onClick={() => jumpTo(symbol.line)}
                            >
                              <code>{symbol.name}</code>
                              <span>L{symbol.line}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </section>
                  </>
                ) : (
                  <p className="muted">Select a source file to inspect it.</p>
                )}
              </div>
            )}
          </aside>
        ) : null}
      </main>

      {notice ? (
        <div className="toast" role="status">
          {notice}
        </div>
      ) : null}
      {modal === "import" ? (
        <Modal title="Open repository" onClose={closeModal}>
          <div className="import-tabs" role="group" aria-label="Import from">
            <button
              aria-pressed={importTab === "github"}
              disabled={importing}
              onClick={() => {
                setImportTab("github");
                setImportError("");
              }}
            >
              <Github size={16} /> GitHub
            </button>
            <button
              aria-pressed={importTab === "zip"}
              disabled={importing}
              onClick={() => {
                setImportTab("zip");
                setImportError("");
              }}
            >
              <Upload size={16} /> ZIP archive
            </button>
          </div>
          {importTab === "github" ? (
            <form
              className="repo-form"
              onSubmit={(event) => {
                event.preventDefault();
                void openRepository((signal) => importGithub(repoUrl, signal));
              }}
            >
              <label htmlFor="repo-url">Public GitHub repository</label>
              <input
                id="repo-url"
                placeholder="owner/repository"
                value={repoUrl}
                disabled={importing}
                onChange={(event) => setRepoUrl(event.target.value)}
              />
              <button
                className="button primary"
                type="submit"
                disabled={!repoUrl.trim() || importing}
              >
                {importing ? (
                  <>
                    <Loader2 size={15} className="spin" /> Opening…
                  </>
                ) : (
                  <>
                    Open repository <ArrowRight size={15} />
                  </>
                )}
              </button>
            </form>
          ) : (
            <div
              className="upload-zone"
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                loadZip(event.dataTransfer.files[0]);
              }}
            >
              {importing ? (
                <Loader2 size={22} className="spin" />
              ) : (
                <Upload size={22} />
              )}
              <button
                className="text-button"
                disabled={importing}
                onClick={() => zipInput.current?.click()}
              >
                {importing ? "Reading ZIP…" : "Choose a ZIP or drop it here"}
              </button>
              <p>Up to 20 MB. Files stay in this tab.</p>
              <input
                ref={zipInput}
                type="file"
                accept=".zip,application/zip"
                hidden
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  event.currentTarget.value = "";
                  loadZip(file);
                }}
              />
            </div>
          )}
          {importError ? (
            <p className="inline-error" role="alert">
              {importError}
            </p>
          ) : null}
          <div className="example-row">
            <button
              className="text-button"
              disabled={importing}
              onClick={() => applyRepo(exampleRepository)}
            >
              Open the Fieldnotes example <ArrowRight size={15} />
            </button>
          </div>
        </Modal>
      ) : null}
      {modal === "search" ? (
        <Modal title="Find a file" onClose={closeModal}>
          <label className="palette-input">
            <Search size={17} />
            <input
              aria-label="Search file paths"
              placeholder="Type a filename or path"
              value={paletteQuery}
              onChange={(event) => setPaletteQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && paletteFiles[0])
                  openInFiles(paletteFiles[0]);
              }}
            />
          </label>
          <div className="palette-results">
            {paletteFiles.map((file) => (
              <button key={file.path} onClick={() => openInFiles(file)}>
                <FileIcon name={file.name} />
                <span title={file.path}>{file.path}</span>
                <ChevronRight size={15} />
              </button>
            ))}
            {!paletteFiles.length ? (
              <p className="empty-small">No matching files.</p>
            ) : null}
          </div>
        </Modal>
      ) : null}
      {modal === "help" ? (
        <Modal title="Using GitMap" onClose={closeModal}>
          <div className="help-content">
            <p>
              Arrows point from a file to the files it imports. Select a node
              for its local imports and source. Focus shows immediate neighbors.
              Impact traces every file that depends on the selected file through
              scanned imports.
            </p>
            <p>
              Drag the canvas to pan. Drag a file to move it. Double-click a
              file to read its code or a grouped folder to expand it.
            </p>
            <dl>
              <div>
                <dt>Find any file</dt>
                <dd>
                  <kbd>Ctrl / ⌘</kbd> <kbd>K</kbd>
                </dd>
              </div>
              <div>
                <dt>Focus the current filter</dt>
                <dd>
                  <kbd>/</kbd>
                </dd>
              </div>
              <div>
                <dt>Close a dialog or inspector</dt>
                <dd>
                  <kbd>Esc</kbd>
                </dd>
              </div>
            </dl>
            <a className="button" href="/gitmap-source.zip" download>
              <ArrowDownToLine size={16} /> Download project source
            </a>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
