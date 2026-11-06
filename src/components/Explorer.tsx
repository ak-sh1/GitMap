import { memo } from "react";
import {
  ChevronDown,
  ChevronRight,
  File,
  FileCode2,
  FileJson2,
  FileText,
  Folder,
  FolderOpen,
  Search,
  ChevronsDownUp,
} from "lucide-react";
import type { TreeNode } from "../types";

export function FileIcon({ name, size = 15 }: { name: string; size?: number }) {
  if (/\.(py|ts|tsx|js|jsx|rs|go|java|c|cpp)$/.test(name))
    return (
      <FileCode2
        size={size}
        className={`file-icon ${name.endsWith(".py") ? "python" : ""}`}
      />
    );
  if (/\.(json|yml|yaml|toml)$/.test(name))
    return <FileJson2 size={size} className="file-icon" />;
  if (/\.(md|txt)$/.test(name))
    return <FileText size={size} className="file-icon" />;
  return <File size={size} className="file-icon" />;
}

type Props = {
  root: TreeNode;
  selected: string;
  expanded: Set<string>;
  query: string;
  onQuery: (value: string) => void;
  onSelect: (node: TreeNode) => void;
  onToggle: (path: string) => void;
  onCollapse: () => void;
};
const TreeRow = memo(function TreeRow({
  node,
  depth,
  props,
}: {
  node: TreeNode;
  depth: number;
  props: Props;
}) {
  const match = (n: TreeNode): boolean =>
    n.path.toLowerCase().includes(props.query.toLowerCase()) ||
    n.children.some(match);
  if (props.query && !match(node)) return null;
  const folder = node.type === "folder";
  const open = props.expanded.has(node.path) || !!props.query;
  return (
    <div
      role="treeitem"
      aria-expanded={folder ? open : undefined}
      aria-selected={props.selected === node.path}
    >
      <button
        className={`tree-row ${props.selected === node.path ? "selected" : ""}`}
        style={{ paddingLeft: 12 + depth * 16 }}
        onClick={() => {
          props.onSelect(node);
          if (folder) props.onToggle(node.path);
        }}
        title={node.path}
      >
        <span className="tree-caret">
          {folder ? (
            open ? (
              <ChevronDown size={13} />
            ) : (
              <ChevronRight size={13} />
            )
          ) : null}
        </span>
        {folder ? (
          open ? (
            <FolderOpen size={15} className="folder-icon" />
          ) : (
            <Folder size={15} className="folder-icon" />
          )
        ) : (
          <FileIcon name={node.name} />
        )}
        <span className="tree-name">{node.name}</span>
      </button>
      {folder && open ? (
        <div role="group">
          {node.children.map((child) => (
            <TreeRow
              key={child.path}
              node={child}
              depth={depth + 1}
              props={props}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
});
export default function Explorer(props: Props) {
  const visible = props.root.children.some(function match(n): boolean {
    return (
      n.path.toLowerCase().includes(props.query.toLowerCase()) ||
      n.children.some(match)
    );
  });
  return (
    <>
      <div className="section-label explorer-label">
        <span>FILES</span>
        <button
          className="icon-button"
          onClick={props.onCollapse}
          title="Collapse folders"
          aria-label="Collapse folders"
        >
          <ChevronsDownUp size={14} />
        </button>
      </div>
      <label className="file-search">
        <Search size={14} />
        <input
          aria-label="Filter files"
          placeholder="Filter files…"
          value={props.query}
          onChange={(e) => props.onQuery(e.target.value)}
        />
        <kbd>/</kbd>
      </label>
      <div role="tree" aria-label="Repository files" className="tree">
        {props.root.children.map((node) => (
          <TreeRow key={node.path} node={node} depth={0} props={props} />
        ))}
        {!visible ? <p className="empty-small">No matching files.</p> : null}
      </div>
    </>
  );
}
