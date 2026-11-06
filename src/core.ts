import type { Entry, Outline, TreeNode } from "./types";

const ignored = new Set([
  ".git",
  "node_modules",
  ".venv",
  "venv",
  "__pycache__",
  ".next",
  ".nuxt",
  "dist",
  "build",
  ".DS_Store",
  ".idea",
  ".vscode",
  "coverage",
  "__MACOSX",
]);
const sensitive =
  /(^|\/)(\.env(?:\..+)?|id_rsa|id_ed25519|credentials\.json|.*\.(pem|key))$/i;
const binary =
  /\.(png|jpg|jpeg|gif|webp|ico|pdf|woff2?|ttf|otf|mp[34]|mov|zip|gz|tar|exe|so|dylib|dll|sqlite3?|db|lock|pyc)$/i;

export function includePath(path: string) {
  return (
    !!path &&
    path.length <= 1024 &&
    path.split("/").length <= 64 &&
    !path.includes("\\") &&
    !path
      .split("/")
      .some((p) => !p || ignored.has(p) || p === ".." || p === ".") &&
    !path.startsWith("/") &&
    !sensitive.test(path)
  );
}
export function textFile(path: string) {
  return !binary.test(path);
}
export function language(path: string) {
  const ext = path.split(".").pop()?.toLowerCase() || "";
  return (
    (
      {
        py: "Python",
        ts: "TypeScript",
        tsx: "TypeScript",
        js: "JavaScript",
        jsx: "JavaScript",
        json: "JSON",
        md: "Markdown",
        css: "CSS",
        html: "HTML",
        yml: "YAML",
        yaml: "YAML",
        rs: "Rust",
        go: "Go",
        java: "Java",
        sql: "SQL",
        sh: "Shell",
        txt: "Text",
        toml: "TOML",
        c: "C",
        cpp: "C++",
      } as Record<string, string>
    )[ext] || "Text"
  );
}
export function buildTree(entries: Entry[]): TreeNode {
  const root: TreeNode = { path: "", name: "", type: "folder", children: [] };
  const nodes = new Map<string, TreeNode>([["", root]]);
  for (const entry of entries) {
    if (!includePath(entry.path)) continue;
    const parts = entry.path.split("/");
    for (let i = 0; i < parts.length; i++) {
      const path = parts.slice(0, i + 1).join("/");
      if (!nodes.has(path)) {
        const node: TreeNode = {
          path,
          name: parts[i],
          type: i === parts.length - 1 ? entry.type : "folder",
          children: [],
        };
        nodes.set(path, node);
        nodes.get(parts.slice(0, i).join("/"))!.children.push(node);
      }
      if (i === parts.length - 1) Object.assign(nodes.get(path)!, entry);
    }
  }
  const sort = (node: TreeNode) => {
    node.children.sort((a, b) =>
      a.type !== b.type
        ? a.type === "folder"
          ? -1
          : 1
        : a.name.localeCompare(b.name),
    );
    node.children.forEach(sort);
  };
  sort(root);
  return root;
}
export function flattenTree(root: TreeNode): TreeNode[] {
  return root.children.flatMap((node) => [node, ...flattenTree(node)]);
}
export function parseRepository(input: string): {
  owner: string;
  name: string;
  branch?: string;
} {
  const clean = input.trim().replace(/\/$/, "");
  const trimmed = clean.startsWith("github.com/") ? `https://${clean}` : clean;
  let path = trimmed;
  if (trimmed.includes("://")) {
    const url = new URL(trimmed);
    if (
      url.protocol !== "https:" ||
      url.hostname !== "github.com" ||
      url.username ||
      url.password ||
      url.port
    )
      throw new Error("Use a public github.com repository URL.");
    path = url.pathname.slice(1);
  }
  const parts = path.split("/");
  if (
    parts.length < 2 ||
    !/^[\w.-]+$/.test(parts[0]) ||
    !/^[\w.-]+$/.test(parts[1]) ||
    [".", ".."].includes(parts[0]) ||
    [".", "..", ".git"].includes(parts[1])
  )
    throw new Error("Enter a repository as owner/name or a GitHub URL.");
  if (parts.length > 2 && parts[2] !== "tree")
    throw new Error("Use the repository URL, rather than a file URL.");
  return {
    owner: parts[0],
    name: parts[1].replace(/\.git$/, ""),
    branch:
      parts[2] === "tree"
        ? decodeURIComponent(parts.slice(3).join("/")) || undefined
        : undefined,
  };
}
export function analyzeFile(path: string, content: string): Outline {
  const lines = content.split("\n");
  const symbols: Outline["symbols"] = [];
  const imports: string[] = [];
  if (/\.(py|tsx?|jsx?|rs|go|java|c|cpp)$/.test(path))
    lines.forEach((line, index) => {
      const symbol =
        line.match(
          /^\s*(?:export\s+(?:default\s+)?)?(?:async\s+)?(class|def|function|interface|type|enum|struct|fn)\s+([\w$]+)/,
        ) ||
        line.match(
          /^\s*(?:export\s+)?(const|let)\s+([\w$]+)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[\w$]+)\s*=>/,
        );
      if (symbol)
        symbols.push({
          kind:
            symbol[1] === "def" ||
            symbol[1] === "fn" ||
            symbol[1] === "const" ||
            symbol[1] === "let"
              ? "function"
              : symbol[1],
          name: symbol[2],
          line: index + 1,
        });
      const imp =
        line.match(/^\s*from\s+([\w.]+)\s+import/) ||
        line.match(/^\s*import\s+([\w.]+)(?:\s|$)/) ||
        line.match(/(?:from\s*|import\s*|require\()['"]([^'"]+)['"]/);
      if (imp) imports.push(imp[1]);
    });
  const doc = content
    .match(/^\s*(?:"""|''')([\s\S]*?)(?:"""|''')/)?.[1]
    ?.trim()
    .split("\n\n")[0];
  const paragraph = path.endsWith(".md")
    ? lines
        .filter((line) => line.trim() && !/^[#`|\->*<]/.test(line.trim()))
        .slice(0, 2)
        .join(" ")
        .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    : "";
  let description = doc || paragraph;
  if (!description) {
    if (path.endsWith(".json")) {
      try {
        const j = JSON.parse(content);
        description =
          j.description ||
          `Configuration with ${Object.keys(j).length} top-level fields.`;
      } catch {
        description = "JSON data and configuration.";
      }
    } else if (symbols.length)
      description = `Defines ${symbols
        .slice(0, 3)
        .map((s) => s.name)
        .join(
          ", ",
        )}${symbols.length > 3 ? ` and ${symbols.length - 3} more symbols` : ""}.`;
    else
      description = `${language(path)} file containing ${lines.length} lines.`;
  }
  return {
    description: String(description).slice(0, 700),
    symbols,
    imports: [...new Set(imports)],
    lines: lines.length,
    language: language(path),
  };
}
export function relatedFiles(
  path: string,
  imports: string[],
  entries: Entry[],
): Entry[] {
  const candidates = imports.filter(
    (x) => x.startsWith(".") || x.startsWith("@/"),
  );
  return entries
    .filter(
      (e) =>
        e.type === "file" &&
        e.path !== path &&
        candidates.some((imp) => {
          const base = imp.startsWith("@/")
            ? `src/${imp.slice(2)}`
            : [...path.split("/").slice(0, -1), ...imp.split("/")]
                .reduce<
                  string[]
                >((a, p) => (p === ".." ? a.slice(0, -1) : p === "." ? a : [...a, p]), [])
                .join("/");
          return (
            e.path.replace(/\.(py|tsx?|jsx?)$/, "").replace(/\/index$/, "") ===
            base.replace(/\.(py|tsx?|jsx?)$/, "")
          );
        }),
    )
    .slice(0, 8);
}
export function formatBytes(n: number) {
  return n < 1024
    ? `${n} B`
    : n < 1024 * 1024
      ? `${(n / 1024).toFixed(1)} KB`
      : `${(n / 1024 / 1024).toFixed(1)} MB`;
}
