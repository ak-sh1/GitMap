import { ArrowDownLeft, ArrowUpRight } from "lucide-react";
import type { DependencyGraph } from "../dependencies";

export default function FileRelations({
  graph,
  selected,
  onSelect,
}: {
  graph: DependencyGraph;
  selected: string;
  onSelect: (path: string) => void;
}) {
  if (!graph.indexed.has(selected)) return null;
  const imports = graph.edges.filter((e) => e.source === selected);
  const usedBy = graph.edges.filter((e) => e.target === selected);
  const other = graph.external.get(selected) || [];
  return (
    <>
      {graph.errors.has(selected) ? (
        <div className="inline-error">
          This file could not be parsed. Its outgoing connections are
          unavailable.
        </div>
      ) : null}
      <div className="note-section">
        <div className="note-section-title">
          <h3>Imports</h3>
          <span>{imports.length}</span>
        </div>
        <div className="graph-connections">
          {imports.map((e) => (
            <button
              key={e.target}
              data-direction="imports"
              onClick={() => onSelect(e.target)}
              title={`${e.target}\nImported on line ${e.lines.join(", ")}`}
            >
              <ArrowUpRight size={12} />
              <span>{e.target}</span>
              <small>L{e.lines.join(", ")}</small>
            </button>
          ))}
          {!imports.length ? (
            <p className="muted small">No local imports resolved.</p>
          ) : null}
        </div>
      </div>
      <div className="note-section">
        <div className="note-section-title">
          <h3>Used by</h3>
          <span>{usedBy.length}</span>
        </div>
        <div className="graph-connections">
          {usedBy.map((e) => (
            <button
              key={e.source}
              onClick={() => onSelect(e.source)}
              title={e.source}
            >
              <ArrowDownLeft size={12} />
              <span>{e.source}</span>
            </button>
          ))}
          {!usedBy.length ? (
            <p className="muted small">No incoming imports in scanned files.</p>
          ) : null}
        </div>
      </div>
      {other.length ? (
        <div className="note-section">
          <div className="note-section-title">
            <h3>Other imports</h3>
            <span>{other.length}</span>
          </div>
          <p className="muted small">
            External packages or paths not resolved locally.
          </p>
          <div className="other-imports">
            {other.map((name) => (
              <code key={name}>{name}</code>
            ))}
          </div>
        </div>
      ) : null}
    </>
  );
}
