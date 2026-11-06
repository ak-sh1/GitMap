import { parse } from "@babel/parser";
import JSON5 from "json5";
import type { Entry } from "./types";

export type ImportRef = {
  module: string;
  names?: string[];
  line: number;
  kind: "import" | "re-export" | "require";
  relative?: number;
};
export type DependencyEdge = {
  source: string;
  target: string;
  lines: number[];
  imports: string[];
};
export type DependencyGraph = {
  files: string[];
  edges: DependencyEdge[];
  external: Map<string, string[]>;
  errors: Map<string, string>;
  indexed: Set<string>;
};
type Aliases = {
  base: string;
  scope: string;
  paths: Record<string, string[]>;
  configured: boolean;
};
export const isSource = (path: string) =>
  /\.(py|[cm]?[jt]sx?)$/i.test(path) && !/\.d\.[cm]?ts$/.test(path);
export const directory = (path: string) =>
  path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "(root)";

export function normalizePath(path: string): string {
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (!parts.length) return "";
      parts.pop();
    } else parts.push(part);
  }
  return parts.join("/");
}

// Tokenize logical Python statements so comments, docstrings and continuations
// cannot be confused with import declarations. No repository code is executed.
export function pythonImports(content: string): ImportRef[] {
  const tokens = content.matchAll(
    /(?:[rubf]{0,2})(?:"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*')|\#[^\n]*|\\\r?\n|\r?\n|[A-Za-z_]\w*|\.+|[(),;]|[^\s]/gi,
  );
  const result: ImportRef[] = [];
  let statement: string[] = [],
    depth = 0,
    line = 1,
    start = 1;
  const flush = () => {
    const t = statement;
    statement = [];
    const first = t[0];
    if (first === "import") {
      // Keep aliases separate rather than allowing "as" into a module name.
      let segment: string[] = [];
      const push = () => {
        const end = segment.indexOf("as");
        const module = (end < 0 ? segment : segment.slice(0, end)).join("");
        if (module) result.push({ module, line: start, kind: "import" });
        segment = [];
      };
      for (const token of t.slice(1)) {
        if (token === ",") push();
        else segment.push(token);
      }
      push();
    } else if (first === "from") {
      const split = t.indexOf("import");
      if (split < 0) return;
      const spec = t.slice(1, split).join("");
      const relative = spec.match(/^\.+/)?.[0].length || 0;
      const module = spec.slice(relative);
      const names: string[] = [];
      let afterComma = true;
      for (const token of t.slice(split + 1)) {
        if (token === "(" || token === ")") continue;
        if (token === ",") {
          afterComma = true;
          continue;
        }
        if (afterComma) {
          names.push(token);
          afterComma = false;
        }
      }
      result.push({ module, names, line: start, kind: "import", relative });
    }
  };
  for (const match of tokens) {
    const token = match[0];
    const newlines = (token.match(/\n/g) || []).length;
    if (
      token[0] === "#" ||
      /^(?:[rubf]{0,2})["']/i.test(token) ||
      token.startsWith("\\")
    ) {
      line += newlines;
      continue;
    }
    if (token === "\n" || token === "\r\n" || token === ";") {
      if (depth === 0) flush();
      line += newlines;
      continue;
    }
    if (!statement.length) start = line;
    if (token === "(") depth++;
    if (token === ")") depth = Math.max(0, depth - 1);
    statement.push(token);
    // Imports inside an if/try/function body follow their own newline, while a
    // single-line "if TYPE_CHECKING: import x" is intentionally not guessed.
  }
  flush();
  return result;
}

export function javascriptImports(path: string, content: string): ImportRef[] {
  const ast = parse(content, {
    sourceType: "unambiguous",
    plugins: [
      ...(/\.[cm]?tsx?$/.test(path) ? ["typescript" as const] : []),
      ...(/\.(?:[cm]?jsx?|tsx)$/.test(path) ? ["jsx" as const] : []),
    ],
    errorRecovery: false,
  });
  const result: ImportRef[] = [];
  const visit = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    const n = node as Record<string, unknown>;
    const type = n.type;
    const source = n.source as { value?: string } | undefined;
    const line =
      (n.loc as { start: { line: number } } | undefined)?.start.line || 1;
    if (
      (type === "ImportDeclaration" ||
        type === "ExportNamedDeclaration" ||
        type === "ExportAllDeclaration") &&
      typeof source?.value === "string"
    )
      result.push({
        module: source.value,
        line,
        kind: type === "ImportDeclaration" ? "import" : "re-export",
      });
    if (type === "ImportExpression" && typeof source?.value === "string")
      result.push({ module: source.value, line, kind: "import" });
    if (type === "CallExpression") {
      const callee = n.callee as { type?: string; name?: string } | undefined;
      const args = n.arguments as
        | { type?: string; value?: string }[]
        | undefined;
      if (
        (callee?.type === "Import" ||
          (callee?.type === "Identifier" && callee.name === "require")) &&
        args?.[0]?.type === "StringLiteral"
      )
        result.push({
          module: args[0].value!,
          line,
          kind: callee.type === "Import" ? "import" : "require",
        });
    }
    for (const [key, value] of Object.entries(n)) {
      if (
        [
          "loc",
          "start",
          "end",
          "extra",
          "comments",
          "tokens",
          "errors",
        ].includes(key)
      )
        continue;
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === "object") visit(value);
    }
  };
  visit(ast.program);
  return result;
}

function configAliases(contents: Map<string, string>): Aliases[] {
  const result: Aliases[] = [];
  for (const [path, content] of contents) {
    if (!/(^|\/)(tsconfig|jsconfig)(?:\.[^/]+)?\.json$/.test(path)) continue;
    try {
      const c = JSON5.parse(content).compilerOptions || {};
      const parent = directory(path) === "(root)" ? "" : directory(path);
      result.push({
        base: normalizePath(`${parent}/${c.baseUrl || "."}`),
        scope: parent,
        paths: c.paths || {},
        configured: !!c.baseUrl,
      });
    } catch {
      /* Invalid configuration is not used to invent import targets. */
    }
  }
  return result;
}

export function buildDependencyGraph(
  entries: Entry[],
  contents: Map<string, string>,
): DependencyGraph {
  const available = new Set(
    entries.filter((e) => e.type === "file").map((e) => e.path),
  );
  const indexed = new Set([...contents.keys()].filter(isSource));
  const edges = new Map<string, DependencyEdge>();
  const external = new Map<string, string[]>(),
    errors = new Map<string, string>();
  const aliases = configAliases(contents);
  const find = (base: string, python = false): string | undefined => {
    if (!base) return undefined;
    const candidates = python
      ? [`${base}.py`, `${base}/__init__.py`]
      : [
          base,
          ...[
            ".ts",
            ".tsx",
            ".js",
            ".jsx",
            ".mjs",
            ".cjs",
            ".mts",
            ".cts",
            ".json",
            ".css",
          ].map((x) => base + x),
          ...[".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"].map(
            (x) => `${base}/index${x}`,
          ),
        ];
    return candidates.find((p) => available.has(p));
  };
  const jsResolve = (from: string, module: string): string | undefined => {
    const resolve = (base: string) =>
      find(base) ||
      (/\.[cm]?tsx?$/.test(from) && /\.[cm]?js$/.test(base)
        ? find(
            base
              .replace(/\.mjs$/, ".mts")
              .replace(/\.cjs$/, ".cts")
              .replace(/\.js$/, ".ts"),
          )
        : undefined);
    if (module.startsWith("."))
      return resolve(
        normalizePath(
          `${directory(from) === "(root)" ? "" : directory(from)}/${module}`,
        ),
      );
    const relevant = aliases
      .filter((a) => !a.scope || from.startsWith(a.scope + "/"))
      .sort((a, b) => b.scope.length - a.scope.length);
    for (const config of relevant) {
      for (const [pattern, targets] of Object.entries(config.paths)) {
        const [prefix, suffix = ""] = pattern.split("*");
        const match = pattern.includes("*")
          ? module.startsWith(prefix) && module.endsWith(suffix)
          : module === pattern;
        if (!match) continue;
        const wildcard = pattern.includes("*")
          ? module.slice(prefix.length, module.length - suffix.length)
          : "";
        for (const target of targets) {
          const file = resolve(
            normalizePath(`${config.base}/${target.replace("*", wildcard)}`),
          );
          if (file) return file;
        }
      }
      if (config.configured) {
        const file = resolve(normalizePath(`${config.base}/${module}`));
        if (file) return file;
      }
    }
    return undefined;
  };
  const pyResolve = (from: string, ref: ImportRef): string[] => {
    const parents = from.split("/").slice(0, -1);
    const roots = ref.relative
      ? ref.relative > parents.length
        ? []
        : [parents.slice(0, parents.length - (ref.relative - 1)).join("/")]
      : [
          "",
          "src",
          ...["backend", "server"].filter((p) => from.startsWith(p + "/")),
        ];
    const module = ref.module.replace(/\./g, "/");
    const matches: string[] = [];
    for (const root of roots) {
      const base = normalizePath(`${root}/${module}`);
      const parent = find(base, true);
      if (parent) matches.push(parent);
      for (const name of ref.names || []) {
        if (name === "*") continue;
        const child = find(normalizePath(`${base}/${name}`), true);
        if (child) matches.push(child);
      }
      if (matches.length) break;
    }
    return [...new Set(matches)];
  };
  for (const [path, content] of contents) {
    if (!isSource(path)) continue;
    try {
      const refs = path.endsWith(".py")
        ? pythonImports(content)
        : javascriptImports(path, content);
      for (const ref of refs) {
        const targets = path.endsWith(".py")
          ? pyResolve(path, ref)
          : [jsResolve(path, ref.module)].filter((v): v is string => !!v);
        if (!targets.length) {
          const list = external.get(path) || [];
          if (!list.includes(ref.module))
            list.push(ref.module || ".".repeat(ref.relative || 0));
          external.set(path, list);
        }
        for (const target of targets) {
          if (target === path) continue;
          const key = `${path}\0${target}`;
          const edge = edges.get(key) || {
            source: path,
            target,
            lines: [],
            imports: [],
          };
          if (!edge.lines.includes(ref.line)) edge.lines.push(ref.line);
          const spec = ".".repeat(ref.relative || 0) + ref.module;
          if (!edge.imports.includes(spec)) edge.imports.push(spec);
          edges.set(key, edge);
        }
      }
    } catch (e) {
      errors.set(path, (e as Error).message);
    }
  }
  const files = [
    ...new Set([
      ...indexed,
      ...[...edges.values()].flatMap((e) => [e.source, e.target]),
    ]),
  ].sort();
  return { files, edges: [...edges.values()], external, errors, indexed };
}

export function traceDependents(graph: DependencyGraph, target: string) {
  const importers = new Map<string, string[]>();
  for (const edge of graph.edges) {
    const files = importers.get(edge.target) ?? [];
    files.push(edge.source);
    importers.set(edge.target, files);
  }
  const distance = new Map([[target, 0]]);
  const queue = [target];
  for (let index = 0; index < queue.length; index++) {
    const file = queue[index];
    const nextDistance = distance.get(file)! + 1;
    for (const importer of importers.get(file) ?? []) {
      if (distance.has(importer)) continue;
      distance.set(importer, nextDistance);
      queue.push(importer);
    }
  }
  return distance;
}

export type DisplayNode = {
  id: string;
  path: string;
  label: string;
  folder: string;
  files: string[];
  kind: "file" | "folder";
  indexed: boolean;
};
export type DisplayEdge = {
  source: string;
  target: string;
  count: number;
  original: DependencyEdge[];
};
export function displayGraph(
  graph: DependencyGraph,
  collapsed: Set<string>,
  selected: string,
  focus: boolean,
  showIsolated: boolean,
  scope?: ReadonlyMap<string, number>,
) {
  const neighbors = new Set([selected]);
  graph.edges.forEach((e) => {
    if (e.source === selected) neighbors.add(e.target);
    if (e.target === selected) neighbors.add(e.source);
  });
  const connected = new Set(graph.edges.flatMap((e) => [e.source, e.target]));
  const focusSelected = focus && graph.files.includes(selected);
  const files = graph.files.filter((path) =>
    scope
      ? scope.has(path)
      : (!focusSelected || neighbors.has(path)) &&
        (showIsolated || connected.has(path) || path === selected),
  );
  const nodes = new Map<string, DisplayNode>(),
    mapping = new Map<string, string>();
  for (const path of files) {
    const folder = directory(path);
    const id = collapsed.has(folder) ? `folder:${folder}` : path;
    mapping.set(path, id);
    if (nodes.has(id)) {
      nodes.get(id)!.files.push(path);
      continue;
    }
    nodes.set(id, {
      id,
      path,
      label: collapsed.has(folder)
        ? folder.split("/").pop() || folder
        : path.split("/").pop()!,
      folder,
      files: [path],
      kind: collapsed.has(folder) ? "folder" : "file",
      indexed: graph.indexed.has(path),
    });
  }
  const edges = new Map<string, DisplayEdge>();
  for (const edge of graph.edges) {
    const source = mapping.get(edge.source),
      target = mapping.get(edge.target);
    if (!source || !target || source === target) continue;
    const key = `${source}\0${target}`;
    const item = edges.get(key) || { source, target, count: 0, original: [] };
    item.count++;
    item.original.push(edge);
    edges.set(key, item);
  }
  return {
    nodes: [...nodes.values()],
    edges: [...edges.values()],
    hidden: graph.files.length - files.length,
  };
}

// Condense circular imports before placing files in dependency layers.
export function layoutGraph(
  nodes: DisplayNode[],
  edges: DisplayEdge[],
): Map<string, { x: number; y: number }> {
  const adj = new Map(nodes.map((node) => [node.id, [] as string[]]));
  const connected = new Set<string>();
  for (const edge of edges) {
    adj.get(edge.source)?.push(edge.target);
    connected.add(edge.source);
    connected.add(edge.target);
  }
  let next = 0;
  const stack: string[] = [],
    onStack = new Set<string>(),
    index = new Map<string, number>(),
    low = new Map<string, number>(),
    groups: string[][] = [];
  const visit = (id: string) => {
    index.set(id, next);
    low.set(id, next++);
    stack.push(id);
    onStack.add(id);
    for (const target of adj.get(id) || []) {
      if (!index.has(target)) {
        visit(target);
        low.set(id, Math.min(low.get(id)!, low.get(target)!));
      } else if (onStack.has(target))
        low.set(id, Math.min(low.get(id)!, index.get(target)!));
    }
    if (low.get(id) === index.get(id)) {
      const group: string[] = [];
      let v: string;
      do {
        v = stack.pop()!;
        onStack.delete(v);
        group.push(v);
      } while (v !== id);
      groups.push(group);
    }
  };
  nodes.forEach((n) => {
    if (!index.has(n.id)) visit(n.id);
  });
  const groupOf = new Map<string, number>();
  groups.forEach((g, i) => g.forEach((id) => groupOf.set(id, i)));
  const rank = new Map<number, number>();
  const depth = (i: number): number => {
    if (rank.has(i)) return rank.get(i)!;
    const children = new Set(
      groups[i]
        .flatMap((id) => adj.get(id) || [])
        .map((id) => groupOf.get(id)!)
        .filter((j) => j !== i),
    );
    const value = children.size ? Math.max(...[...children].map(depth)) + 1 : 0;
    rank.set(i, value);
    return value;
  };
  groups.forEach((_, i) => depth(i));
  const max = Math.max(0, ...rank.values());
  const layers = new Map<number, DisplayNode[]>();
  const isolated: DisplayNode[] = [];
  for (const node of nodes) {
    if (!connected.has(node.id)) {
      isolated.push(node);
      continue;
    }
    const layer = max - rank.get(groupOf.get(node.id)!)!;
    const list = layers.get(layer) ?? [];
    list.push(node);
    layers.set(layer, list);
  }

  const layerWidth = Math.max(
    0,
    ...[...layers.values()].map((items) => items.length),
  );
  const vertical = connected.size <= 36 && max <= 8 && layerWidth <= 6;
  const positions = new Map<string, { x: number; y: number }>();
  const columnGap = 238;
  const rowGap = 106;
  for (const [layer, items] of layers) {
    items.sort((a, b) => a.path.localeCompare(b.path));
    items.forEach((node, index) => {
      const centered = index - (items.length - 1) / 2;
      positions.set(
        node.id,
        vertical
          ? { x: centered * columnGap, y: layer * rowGap }
          : { x: layer * columnGap, y: centered * rowGap },
      );
    });
  }

  const columns = Math.max(
    1,
    Math.min(8, Math.ceil(Math.sqrt(isolated.length))),
  );
  const bottom = !layers.size
    ? 0
    : vertical
      ? (max + 1) * rowGap
      : ((layerWidth + 1) * rowGap) / 2;
  const center = vertical ? 0 : (max * columnGap) / 2;
  isolated.forEach((node, index) => {
    const row = Math.floor(index / columns);
    const rowSize = Math.min(columns, isolated.length - row * columns);
    const column = (index % columns) - (rowSize - 1) / 2;
    positions.set(node.id, {
      x: center + column * columnGap,
      y: bottom + row * rowGap,
    });
  });
  return positions;
}
