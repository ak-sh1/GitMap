import { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import hljs from "highlight.js/lib/core";
import python from "highlight.js/lib/languages/python";
import javascript from "highlight.js/lib/languages/javascript";
import typescript from "highlight.js/lib/languages/typescript";
import json from "highlight.js/lib/languages/json";
import css from "highlight.js/lib/languages/css";
import xml from "highlight.js/lib/languages/xml";
import bash from "highlight.js/lib/languages/bash";
import sql from "highlight.js/lib/languages/sql";
import { AlertCircle, FileCode2, Loader2 } from "lucide-react";
import type { TreeNode } from "../types";
import { language } from "../core";
import { FileIcon } from "./Explorer";

for (const [name, grammar] of Object.entries({
  python,
  javascript,
  typescript,
  json,
  css,
  xml,
  bash,
  sql,
}))
  hljs.registerLanguage(name, grammar);

function highlighted(content: string, path: string) {
  const lang = (
    {
      Python: "python",
      JavaScript: "javascript",
      TypeScript: "typescript",
      JSON: "json",
      CSS: "css",
      HTML: "xml",
      Shell: "bash",
      SQL: "sql",
    } as Record<string, string>
  )[language(path)];
  if (lang)
    return hljs.highlight(content, { language: lang, ignoreIllegals: true })
      .value;
  return content
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
function splitHighlight(html: string) {
  const open: string[] = [];
  return html.split("\n").map((line) => {
    const prefix = open.join("");
    for (const token of line.matchAll(/<span\b[^>]*>|<\/span>/g)) {
      if (token[0] === "</span>") open.pop();
      else open.push(token[0]);
    }
    return prefix + line + "</span>".repeat(open.length);
  });
}
export default function SourceViewer({
  node,
  content,
  loading,
  error,
  renderMarkdown,
  activeLine,
  onSelect,
  linePrefix = "line-",
}: {
  node: TreeNode | undefined;
  content: string;
  loading: boolean;
  error: string;
  renderMarkdown: boolean;
  activeLine: number | null;
  onSelect: (n: TreeNode) => void;
  linePrefix?: string;
}) {
  const lines = useMemo(
    () => splitHighlight(highlighted(content, node?.path || "")),
    [content, node?.path],
  );
  if (!node)
    return (
      <div className="empty-view">
        <FileCode2 size={30} />
        <h2>No file selected</h2>
        <p>Select a file from the explorer to read its source.</p>
      </div>
    );
  if (node.type === "folder")
    return (
      <div className="folder-view">
        <span className="eyebrow">DIRECTORY</span>
        <h1>{node.name}</h1>
        <p>{node.children.length} items in this directory.</p>
        <div className="directory-list">
          {node.children.map((child) => (
            <button key={child.path} onClick={() => onSelect(child)}>
              <FileIcon
                name={child.type === "folder" ? "folder" : child.name}
              />
              <span>
                {child.name}
                {child.type === "folder" ? "/" : ""}
              </span>
              <span className="muted">
                {child.type === "folder"
                  ? `${child.children.length} items`
                  : language(child.path)}
              </span>
            </button>
          ))}
        </div>
      </div>
    );
  if (loading)
    return (
      <div className="empty-view">
        <Loader2 size={24} className="spin" />
        <p>Reading file…</p>
      </div>
    );
  if (error)
    return (
      <div className="empty-view error-state">
        <AlertCircle size={26} />
        <h2>Can’t preview this file</h2>
        <p>{error}</p>
      </div>
    );
  if (renderMarkdown && node.path.endsWith(".md"))
    return (
      <article className="markdown document">
        <ReactMarkdown skipHtml>{content}</ReactMarkdown>
      </article>
    );
  return (
    <div className="code-scroll">
      <table className="source-code" aria-label={`Source of ${node.path}`}>
        <tbody>
          {lines.map((line, index) => (
            <tr
              key={index}
              id={`${linePrefix}${index + 1}`}
              className={activeLine === index + 1 ? "active-line" : ""}
            >
              <td className="line-number" aria-hidden="true">
                {index + 1}
              </td>
              <td className="code-line">
                <span dangerouslySetInnerHTML={{ __html: line || " " }} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
