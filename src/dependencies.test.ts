import { describe, expect, it } from "vitest";
import {
  buildDependencyGraph,
  displayGraph,
  javascriptImports,
  layoutGraph,
  traceDependents,
  pythonImports,
} from "./dependencies";
import { exampleRepository } from "./example";
import type { Entry } from "./types";

function fixture(files: Record<string, string>) {
  return {
    entries: Object.keys(files).map(
      (path) => ({ path, type: "file" }) as Entry,
    ),
    contents: new Map(Object.entries(files)),
  };
}
const pairs = (edges: { source: string; target: string }[]) =>
  edges.map((e) => `${e.source} -> ${e.target}`).sort();

describe("Python static imports", () => {
  it("ignores comments, quoted strings and multiline docstrings", () => {
    const refs = pythonImports(
      '# import fake\n"""\nfrom fake import thing\n"""\nx = "import not_real"\nimport os as operating, sys\nfrom .models import (Book as B, User,)\n',
    );
    expect(refs.map((r) => [r.module, r.names, r.relative])).toEqual([
      ["os", undefined, undefined],
      ["sys", undefined, undefined],
      ["models", ["Book", "User"], 1],
    ]);
  });
  it("preserves declaration line numbers across multiline strings", () => {
    expect(
      pythonImports('"""\nhello\n"""\nfrom pkg import Thing\n')[0].line,
    ).toBe(4);
  });
  it("handles multiline imports, relative levels, and continuations", () => {
    const refs = pythonImports(
      "from ..models import (\n    Book,\n    User,\n)\nimport app.models, \\\n    app.routes\n",
    );
    expect(refs.map((r) => r.module)).toEqual([
      "models",
      "app.models",
      "app.routes",
    ]);
    expect(refs[0].relative).toBe(2);
  });
  it("resolves package imports, relative modules, and aliases", () => {
    const f = fixture({
      "pkg/__init__.py": "",
      "pkg/routes.py": "from .models import Book\nfrom . import utils\n",
      "pkg/models.py": "class Book: pass",
      "pkg/utils.py": "",
    });
    const graph = buildDependencyGraph(f.entries, f.contents);
    expect(pairs(graph.edges)).toEqual([
      "pkg/routes.py -> pkg/__init__.py",
      "pkg/routes.py -> pkg/models.py",
      "pkg/routes.py -> pkg/utils.py",
    ]);
  });
  it("does not match a module by an unrelated filename", () => {
    const f = fixture({
      "main.py": "import something\n",
      "other/something.py": "pass",
    });
    expect(buildDependencyGraph(f.entries, f.contents).edges).toEqual([]);
  });
  it("resolves src-layout packages without inventing external-package edges", () => {
    const f = fixture({
      "src/app/main.py": "from app.store import Store\nimport flask",
      "src/app/store.py": "class Store: pass",
    });
    const graph = buildDependencyGraph(f.entries, f.contents);
    expect(pairs(graph.edges)).toEqual(["src/app/main.py -> src/app/store.py"]);
    expect(graph.external.get("src/app/main.py")).toEqual(["flask"]);
  });
});
describe("JavaScript and TypeScript parsing", () => {
  it("reads imports, re-exports, require, and literal dynamic imports", () => {
    const refs = javascriptImports(
      "src/main.ts",
      `import type {User} from './types';\nexport {x} from './util';\nexport * from './all';\nconst data=require('./data.json');\nconst later=import('./lazy');\nconst ignored=import(variable);\n// import fake from './fake'\nconst str="require('./not-real')";`,
    );
    expect(refs.map((r) => r.module)).toEqual([
      "./types",
      "./util",
      "./all",
      "./data.json",
      "./lazy",
    ]);
  });
  it("resolves extensions, index files, configured aliases, and type-only imports", () => {
    const f = fixture({
      "tsconfig.json":
        '{ // JSONC\n "compilerOptions": {"baseUrl":".","paths":{"@/*":["src/*"]}}\n}',
      "src/main.tsx":
        "import {Button} from '@/components';\nimport type {User} from './types';\nimport './styles.css';",
      "src/components/index.tsx": "export const Button=()=>null;",
      "src/types.ts": "export interface User {}",
      "src/styles.css": "body{}",
    });
    expect(pairs(buildDependencyGraph(f.entries, f.contents).edges)).toEqual([
      "src/main.tsx -> src/components/index.tsx",
      "src/main.tsx -> src/styles.css",
      "src/main.tsx -> src/types.ts",
    ]);
  });
  it("does not guess unconfigured aliases", () => {
    const f = fixture({
      "main.ts": "import x from '@/x'",
      "src/x.ts": "export default 1",
    });
    expect(buildDependencyGraph(f.entries, f.contents).edges).toEqual([]);
  });
  it("resolves TypeScript source behind a JavaScript extension", () => {
    const f = fixture({
      "src/main.ts": "import './worker.js';",
      "src/worker.ts": "export const x=1",
    });
    expect(pairs(buildDependencyGraph(f.entries, f.contents).edges)).toEqual([
      "src/main.ts -> src/worker.ts",
    ]);
  });
  it("reports syntax errors without constructing fake edges", () => {
    const f = fixture({
      "bad.ts": "import { from './x'",
      "x.ts": "export const x=1",
    });
    const graph = buildDependencyGraph(f.entries, f.contents);
    expect(graph.errors.has("bad.ts")).toBe(true);
    expect(graph.edges).toEqual([]);
  });
  it("deduplicates repeated edges while retaining import line numbers", () => {
    const f = fixture({
      "a.ts": "import {a} from './b';\nimport {b} from './b';",
      "b.ts": "export const a=1,b=2;",
    });
    const graph = buildDependencyGraph(f.entries, f.contents);
    expect(graph.edges.length).toBe(1);
    expect(graph.edges[0].lines).toEqual([1, 2]);
  });
});
describe("bundled application graph", () => {
  it("builds the actual nine relationships in Fieldnotes", () => {
    const contents = new Map(
      exampleRepository.entries
        .filter((e) => e.content !== undefined)
        .map((e) => [e.path, e.content!]),
    );
    const graph = buildDependencyGraph(exampleRepository.entries, contents);
    expect(graph.indexed.size).toBe(10);
    expect(pairs(graph.edges)).toEqual([
      "app/__init__.py -> app/config.py",
      "app/__init__.py -> app/models/database.py",
      "app/__init__.py -> app/routes/books.py",
      "app/__init__.py -> app/routes/health.py",
      "app/models/book.py -> app/models/database.py",
      "app/routes/books.py -> app/services/books.py",
      "app/services/books.py -> app/models/book.py",
      "run.py -> app/__init__.py",
      "tests/conftest.py -> app/__init__.py",
    ]);
    expect(graph.errors.size).toBe(0);
  });
});
describe("graph grouping, focusing, and layout", () => {
  const f = fixture({
    "src/a.ts": "import './b';import '../lib/c'",
    "src/b.ts": "import '../lib/c'",
    "lib/c.ts": "import '../src/a'",
    "alone.ts": "export const x=1;",
  });
  const graph = buildDependencyGraph(f.entries, f.contents);
  it("aggregates folder edges and removes internal folder loops", () => {
    const display = displayGraph(
      graph,
      new Set(["src"]),
      "src/a.ts",
      false,
      true,
    );
    expect(display.nodes.find((n) => n.id === "folder:src")?.files).toEqual([
      "src/a.ts",
      "src/b.ts",
    ]);
    expect(
      display.edges.find(
        (e) => e.source === "folder:src" && e.target === "lib/c.ts",
      )?.count,
    ).toBe(2);
    expect(display.edges.some((e) => e.source === e.target)).toBe(false);
  });
  it("focuses only the selected file and its immediate neighbors", () => {
    const display = displayGraph(graph, new Set(), "src/b.ts", true, true);
    expect(display.nodes.map((n) => n.path).sort()).toEqual([
      "lib/c.ts",
      "src/a.ts",
      "src/b.ts",
    ]);
  });
  it("traces direct and indirect importers once, even across cycles", () => {
    const { entries, contents } = fixture({
      "base.ts": "import './direct';import './other'",
      "direct.ts": "import './base'",
      "top.ts": "import './direct'",
      "other.ts": "export const value = 1;",
    });
    const graph = buildDependencyGraph(entries, contents);
    const impact = traceDependents(graph, "base.ts");
    expect([...impact]).toEqual([
      ["base.ts", 0],
      ["direct.ts", 1],
      ["top.ts", 2],
    ]);
    const view = displayGraph(
      graph,
      new Set(),
      "direct.ts",
      false,
      false,
      impact,
    );
    expect(view.nodes.map((node) => node.path).sort()).toEqual([
      "base.ts",
      "direct.ts",
      "top.ts",
    ]);
  });
  it("can hide unconnected files", () => {
    expect(
      displayGraph(graph, new Set(), "src/a.ts", false, false).nodes.some(
        (n) => n.id === "alone.ts",
      ),
    ).toBe(false);
  });
  it("places a short import chain above unconnected files", () => {
    const { entries, contents } = fixture({
      "main.ts": "import './service'",
      "service.ts": "import './data'",
      "data.ts": "export const value = 1;",
      "unconnected.ts": "export const value = 2;",
    });
    const display = displayGraph(
      buildDependencyGraph(entries, contents),
      new Set(),
      "main.ts",
      false,
      true,
    );
    const positions = layoutGraph(display.nodes, display.edges);
    const rows = ["main.ts", "service.ts", "data.ts", "unconnected.ts"].map(
      (path) => positions.get(path)!.y,
    );
    expect(rows[0]).toBeLessThan(rows[1]);
    expect(rows[1]).toBeLessThan(rows[2]);
    expect(rows[2]).toBeLessThan(rows[3]);
  });
  it("produces finite, deterministic, nonoverlapping positions for cycles", () => {
    const display = displayGraph(graph, new Set(), "src/a.ts", false, true);
    const first = layoutGraph(display.nodes, display.edges),
      second = layoutGraph(display.nodes, display.edges);
    expect([...first]).toEqual([...second]);
    expect(new Set([...first.values()].map((p) => `${p.x},${p.y}`)).size).toBe(
      display.nodes.length,
    );
    expect(
      [...first.values()].every(
        (p) => Number.isFinite(p.x) && Number.isFinite(p.y),
      ),
    ).toBe(true);
  });
});
