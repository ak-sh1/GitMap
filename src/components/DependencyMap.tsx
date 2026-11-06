import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  useNodesState,
} from "@xyflow/react";
import type { Node, NodeProps, ReactFlowInstance } from "@xyflow/react";
import {
  Focus,
  Folder,
  GitFork,
  Loader2,
  Network,
  PanelRight,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import { displayGraph, layoutGraph, traceDependents } from "../dependencies";
import type { DependencyGraph, DisplayNode } from "../dependencies";
import "@xyflow/react/dist/style.css";
import "./dependency-map.css";

type CodeData = DisplayNode & {
  relation: "selected" | "imports" | "used-by" | "both" | "unrelated";
  dimmed: boolean;
  matched: boolean;
  impactRoot: boolean;
};
type CodeNode = Node<CodeData, "code">;
const CodeGraphNode = memo(function CodeGraphNode({
  data,
}: NodeProps<CodeNode>) {
  return (
    <div
      className={`code-graph-node ${data.kind} relation-${data.relation} ${data.dimmed ? "dimmed" : ""} ${data.matched ? "search-match" : ""} ${data.impactRoot ? "impact-root" : ""}`}
      title={
        data.kind === "folder"
          ? `${data.folder} — double-click to expand`
          : data.path
      }
    >
      {(
        [
          ["left", Position.Left],
          ["right", Position.Right],
          ["top", Position.Top],
          ["bottom", Position.Bottom],
        ] as const
      ).flatMap(([side, position]) => [
        <Handle
          key={`in-${side}`}
          id={`in-${side}`}
          type="target"
          position={position}
          isConnectable={false}
        />,
        <Handle
          key={`out-${side}`}
          id={`out-${side}`}
          type="source"
          position={position}
          isConnectable={false}
        />,
      ])}
      <div className="graph-node-top">
        {data.kind === "folder" ? (
          <Folder className="graph-folder-icon" size={16} />
        ) : null}
        <div className="graph-node-title">
          <strong>{data.label}</strong>
          <span>
            {data.kind === "folder"
              ? `${data.files.length} files`
              : data.folder === "(root)"
                ? "Project root"
                : data.folder}
          </span>
        </div>
      </div>
    </div>
  );
});
const NODE_TYPES = { code: CodeGraphNode };
const NO_GROUPS = new Set<string>();
const FIT_OPTIONS = { padding: 0.12, maxZoom: 1.4 };
type Props = {
  graph: DependencyGraph;
  selected: string;
  detailsOpen: boolean;
  onToggleDetails: () => void;
  onOpenDetails: () => void;
  loading: boolean;
  done: number;
  total: number;
  failed: string[];
  onSelect: (path: string) => void;
  onOpenSource: () => void;
  onContinue: () => void;
  onRetry: () => void;
};
export default function DependencyMap({
  graph,
  selected,
  detailsOpen,
  onToggleDetails,
  onOpenDetails,
  loading,
  done,
  total,
  failed,
  onSelect,
  onOpenSource,
  onContinue,
  onRetry,
}: Props) {
  const [focus, setFocus] = useState(false);
  const [impactRoot, setImpactRoot] = useState<string | null>(null);
  const [showIsolated, setShowIsolated] = useState(true);
  const [collapsed, setCollapsed] = useState(new Set<string>());
  const [search, setSearch] = useState("");
  const [nodes, setNodes, onNodesChange] = useNodesState<CodeNode>([]);
  const [instance, setInstance] = useState<ReactFlowInstance<CodeNode> | null>(
    null,
  );
  const [revision, setRevision] = useState(0);
  const dragged = useRef(new Set<string>());
  const impact = useMemo(() => {
    if (!impactRoot) return null;
    const files = traceDependents(graph, impactRoot);
    const direct = [...files.values()].filter(
      (distance) => distance === 1,
    ).length;
    return { files, direct, indirect: files.size - direct - 1 };
  }, [graph, impactRoot]);
  const display = useMemo(
    () =>
      displayGraph(
        graph,
        impact ? NO_GROUPS : collapsed,
        selected,
        focus,
        showIsolated,
        impact?.files,
      ),
    [graph, collapsed, selected, focus, showIsolated, impact],
  );
  const positions = useMemo(
    () => layoutGraph(display.nodes, display.edges),
    [display.nodes, display.edges],
  );
  const folders = useMemo(
    () =>
      [
        ...new Set(
          graph.files.map((p) =>
            p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "(root)",
          ),
        ),
      ].sort(),
    [graph.files],
  );
  const selectedNode = display.nodes.find((n) => n.files.includes(selected));
  const query = search.trim().toLowerCase();
  const matchingPaths = useMemo(
    () =>
      new Set(
        query
          ? graph.files.filter((path) => path.toLowerCase().includes(query))
          : [],
      ),
    [graph.files, query],
  );
  const hasMatches = display.nodes.some((node) =>
    node.files.some((path) => matchingPaths.has(path)),
  );
  const shapeKey =
    display.nodes.map((n) => n.id).join("|") +
    "::" +
    display.edges.map((e) => `${e.source}>${e.target}`).join("|");
  useEffect(() => {
    const outgoing = new Set(
      graph.edges.filter((e) => e.source === selected).map((e) => e.target),
    );
    const incoming = new Set(
      graph.edges.filter((e) => e.target === selected).map((e) => e.source),
    );
    setNodes((previous) => {
      const previousById = new Map(previous.map((n) => [n.id, n]));
      return display.nodes.map((n) => {
        const own = n.files.includes(selected),
          imports = n.files.some((p) => outgoing.has(p)),
          usedBy = n.files.some((p) => incoming.has(p));
        const relation = own
          ? "selected"
          : imports && usedBy
            ? "both"
            : imports
              ? "imports"
              : usedBy
                ? "used-by"
                : "unrelated";
        const matched = n.files.some((path) => matchingPaths.has(path));
        return {
          id: n.id,
          type: "code",
          position:
            dragged.current.has(n.id) && previousById.has(n.id)
              ? previousById.get(n.id)!.position
              : positions.get(n.id)!,
          selected: own,
          zIndex: 3,
          ariaLabel:
            n.kind === "folder"
              ? `Folder ${n.folder}, ${n.files.length} files`
              : `File ${n.path}`,
          data: {
            ...n,
            relation,
            dimmed: query ? !matched : false,
            matched,
            impactRoot: n.path === impactRoot,
          },
        };
      });
    });
  }, [
    display,
    graph,
    selected,
    impactRoot,
    query,
    matchingPaths,
    positions,
    setNodes,
    revision,
  ]);
  useEffect(() => {
    if (!instance || loading || !display.nodes.length) return;
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => {
        const narrow = window.matchMedia("(max-width: 680px)").matches;
        const motion = window.matchMedia(
          "(prefers-reduced-motion: reduce)",
        ).matches;
        void instance.fitView({
          ...FIT_OPTIONS,
          minZoom: narrow ? 0.78 : undefined,
          duration: motion ? 0 : 220,
        });
      });
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, [instance, shapeKey, loading, revision]);
  const edges = useMemo(() => {
    const byId = new Map(nodes.map((node) => [node.id, node.position]));
    return display.edges.map((e) => {
      const own = selectedNode?.id,
        isOutgoing = e.source === own,
        isIncoming = e.target === own;
      const color = isOutgoing ? "#9f4729" : isIncoming ? "#3a6694" : "#8a96a2";
      const highlighted = isOutgoing || isIncoming;
      const sourcePosition = byId.get(e.source) ?? { x: 0, y: 0 };
      const targetPosition = byId.get(e.target) ?? { x: 0, y: 0 };
      const dx = targetPosition.x - sourcePosition.x,
        dy = targetPosition.y - sourcePosition.y;
      const horizontal = Math.abs(dx) > Math.abs(dy) * 1.5;
      const horizontalSide = dx >= 0 ? "right" : "left";
      const verticalSide = dy >= 0 ? "bottom" : "top";
      const acrossLayers = !horizontal && Math.abs(dy) > 160;
      // Route edges that skip rows around the intervening nodes.
      const sourceSide =
        horizontal || acrossLayers ? horizontalSide : verticalSide;
      const targetSide =
        acrossLayers && Math.abs(dx) < 1
          ? horizontalSide
          : horizontal
            ? dx >= 0
              ? "left"
              : "right"
            : dy >= 0
              ? "top"
              : "bottom";
      return {
        id: `${e.source}--${e.target}`,
        source: e.source,
        target: e.target,
        sourceHandle: `out-${sourceSide}`,
        targetHandle: `in-${targetSide}`,
        type: "smoothstep",
        pathOptions: { borderRadius: 9, offset: 16 },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color,
          width: 17,
          height: 17,
        },
        style: {
          stroke: color,
          strokeWidth: highlighted ? 2 : 1.25,
        },
        zIndex: highlighted ? 2 : 0,
        label: e.count > 1 ? `${e.count}` : undefined,
        labelStyle: { fill: "#4b5967", fontSize: 11 },
        labelBgStyle: { fill: "#f7f6f2" },
        ariaLabel: `${e.original.map((o) => o.source).join(", ")} imports ${e.original.map((o) => o.target).join(", ")}`,
      };
    });
  }, [display.edges, selectedNode?.id, nodes]);
  const toggleFolder = useCallback((folder: string) => {
    dragged.current.clear();
    setCollapsed((old) => {
      const n = new Set(old);
      if (n.has(folder)) n.delete(folder);
      else n.add(folder);
      return n;
    });
  }, []);
  function findFile() {
    const match = display.nodes.find((node) =>
      node.files.some((path) => matchingPaths.has(path)),
    );
    if (match && instance) {
      const node = instance.getInternalNode(match.id);
      if (node)
        void instance.setCenter(
          node.internals.positionAbsolute.x + (node.measured.width ?? 0) / 2,
          node.internals.positionAbsolute.y + (node.measured.height ?? 0) / 2,
          {
            zoom: 1.4,
            duration: 300,
          },
        );
      const path = match.files.find((path) => matchingPaths.has(path));
      if (path) onSelect(path);
      setSearch("");
    }
  }
  function inspectNode(node: CodeData) {
    onSelect(node.kind === "file" ? node.path : node.files[0]);
    onOpenDetails();
  }
  const showIndexStatus =
    loading || done < total || failed.length > 0 || graph.errors.size > 0;
  return (
    <section className="dependency-map" aria-label="Dependency graph">
      <div className="dependency-toolbar">
        <label className="graph-search">
          <Search size={16} />
          <input
            aria-label="Find in graph"
            placeholder="Find in graph…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                findFile();
              }
            }}
          />
        </label>
        {query && !hasMatches ? (
          <span className="graph-no-matches" role="status">
            No match
          </span>
        ) : null}
        <button
          className="graph-tool"
          onClick={() => {
            if (impactRoot) dragged.current.clear();
            setImpactRoot(null);
            setFocus(!focus);
          }}
          disabled={!focus && !graph.files.includes(selected)}
          aria-label="Focus file"
          title="Focus file"
          aria-pressed={focus}
        >
          <Focus size={14} />
          <span>Focus</span>
        </button>
        <button
          className="graph-tool"
          disabled={!impactRoot && !graph.files.includes(selected)}
          aria-label="Trace file impact"
          title="Trace files that depend on this file"
          aria-pressed={impactRoot !== null}
          onClick={() => {
            dragged.current.clear();
            setFocus(false);
            setSearch("");
            setImpactRoot(impactRoot ? null : selected);
            if (!impactRoot && detailsOpen) onToggleDetails();
          }}
        >
          <GitFork size={15} />
          <span>Impact</span>
        </button>
        <button
          className="graph-tool"
          aria-label="Graph options"
          title="Graph options"
          popoverTarget="graph-options"
        >
          <SlidersHorizontal size={15} />
          <span>View</span>
        </button>
        <div className="action-popover" id="graph-options" popover="auto">
          <button
            disabled={impact !== null}
            onClick={() => {
              dragged.current.clear();
              setCollapsed(collapsed.size ? new Set() : new Set(folders));
            }}
          >
            {collapsed.size ? "Expand folders" : "Group folders"}
          </button>
          <label>
            <input
              type="checkbox"
              checked={showIsolated}
              disabled={impact !== null}
              onChange={(e) => setShowIsolated(e.target.checked)}
            />
            Show unconnected files
          </label>
          <button
            popoverTarget="graph-options"
            popoverTargetAction="hide"
            onClick={() => {
              dragged.current.clear();
              setRevision((v) => v + 1);
            }}
          >
            Reset layout
          </button>
          {!impact && folders.length > 1 ? (
            <details className="graph-folders">
              <summary>Choose folders to group</summary>
              <div>
                {folders.map((folder) => (
                  <label key={folder} title={folder}>
                    <input
                      type="checkbox"
                      checked={collapsed.has(folder)}
                      onChange={() => toggleFolder(folder)}
                    />
                    <span>{folder}</span>
                  </label>
                ))}
              </div>
            </details>
          ) : null}
        </div>
        <button
          className="graph-tool graph-details-toggle"
          aria-label="File details"
          aria-expanded={detailsOpen}
          aria-controls={detailsOpen ? "file-inspector" : undefined}
          title="File details"
          disabled={!selected}
          onClick={onToggleDetails}
        >
          <PanelRight size={15} />
          <span>Details</span>
        </button>
      </div>
      {impactRoot && impact ? (
        <div className="impact-summary" role="status" title={impactRoot}>
          <span>Impact of</span>
          <strong>{impactRoot.split("/").pop()}</strong>
          <span className="impact-tally">
            {impact.direct} direct · {impact.indirect} indirect
          </span>
          <span className="impact-scope">From scanned imports</span>
        </div>
      ) : null}
      <div
        className="dependency-canvas"
        onKeyDown={(event) => {
          if (event.key !== "Enter" || !(event.target instanceof HTMLElement))
            return;
          const id =
            event.target.closest<HTMLElement>(".react-flow__node")?.dataset.id;
          const node = id ? instance?.getNode(id) : undefined;
          if (node) inspectNode(node.data);
        }}
      >
        <ReactFlow<CodeNode>
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          nodeTypes={NODE_TYPES}
          onInit={setInstance}
          nodesConnectable={false}
          edgesReconnectable={false}
          onNodeDragStart={(_, n) => dragged.current.add(n.id)}
          onNodeClick={(_, n) => inspectNode(n.data)}
          onNodeDoubleClick={(_, n) => {
            if (n.data.kind === "folder") toggleFolder(n.data.folder);
            else {
              onSelect(n.data.path);
              onOpenSource();
            }
          }}
          minZoom={0.12}
          maxZoom={2}
          fitView
          fitViewOptions={FIT_OPTIONS}
          deleteKeyCode={null}
          onlyRenderVisibleElements={nodes.length > 100}
          selectionKeyCode={null}
          panOnDrag
          panOnScroll={false}
          zoomOnScroll
          elementsSelectable
          elevateNodesOnSelect={false}
        >
          <Background
            variant={BackgroundVariant.Dots}
            gap={24}
            size={1}
            color="#c4cad0"
          />
          <Controls
            showInteractive={false}
            position="bottom-left"
            orientation="horizontal"
          />
          {nodes.length > 30 ? (
            <MiniMap
              position="bottom-right"
              nodeColor={(n) =>
                (n.data as CodeData).relation === "selected"
                  ? "#9f4729"
                  : "#b5bec9"
              }
              maskColor="#f7f6f2ba"
              style={{ width: 125, height: 80 }}
            />
          ) : null}
        </ReactFlow>
        {!nodes.length ? (
          <div className="graph-empty">
            {loading ? (
              <>
                <Loader2 className="spin" size={24} />
                <h2>Reading imports…</h2>
                <p>The graph appears as source files are analyzed.</p>
              </>
            ) : (
              <>
                <Network size={28} />
                <h2>No connections to show.</h2>
                <p>
                  {focus
                    ? "Turn off Focus file to see the whole project."
                    : !showIsolated && graph.files.length
                      ? "Show unconnected files from the View menu."
                      : "Import a Python, JavaScript, or TypeScript project."}
                </p>
              </>
            )}
          </div>
        ) : null}
        {selectedNode &&
        display.edges.some(
          (edge) =>
            edge.source === selectedNode.id || edge.target === selectedNode.id,
        ) ? (
          <div
            className="graph-direction-legend"
            aria-label="Connections to the selected file"
          >
            <span>
              <i className="used-by-line" /> Used by
            </span>
            <span>
              <i className="imports-line" /> Imports
            </span>
          </div>
        ) : null}
        {showIndexStatus ? (
          <div className="index-status">
            {loading ? <Loader2 size={12} className="spin" /> : null}
            <span>
              {loading
                ? `Reading ${done} / ${total} files…`
                : `${graph.indexed.size} / ${total} source files indexed`}
            </span>
            {!loading && done < total ? (
              <button onClick={onContinue}>Scan more</button>
            ) : null}
            {!loading && failed.length ? (
              <button onClick={onRetry} title={failed.slice(0, 3).join("\n")}>
                Retry {failed.length} failed
              </button>
            ) : null}
            {graph.errors.size ? (
              <span
                title={[...graph.errors]
                  .map(([p, e]) => `${p}: ${e}`)
                  .join("\n")}
              >
                {graph.errors.size} parse errors
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
