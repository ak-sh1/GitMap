import { expect, it } from "vitest";
import { buildDependencyGraph } from "./dependencies";
import type { Entry } from "./types";

it("resolves test imports into a standard Python src-layout package", () => {
  const files = {
    "src/example/__init__.py": "from .core import Client",
    "src/example/core.py": "class Client: pass",
    "tests/test_core.py": "from example import Client\nfrom example.core import Client as C",
  };
  const entries = Object.keys(files).map(path => ({ path, type: "file" } as Entry));
  const graph = buildDependencyGraph(entries, new Map(Object.entries(files)));
  expect(graph.edges.filter(e => e.source === "tests/test_core.py").map(e => e.target).sort()).toEqual(["src/example/__init__.py", "src/example/core.py"]);
});

it("reads JSX inside JavaScript files", () => {
  const files = {
    "src/App.js":
      "import Button from './Button'; export const App = () => <Button />;",
    "src/Button.js": "export default () => <button>OK</button>;",
  };
  const entries = Object.keys(files).map(
    (path) => ({ path, type: "file" }) as Entry,
  );
  const graph = buildDependencyGraph(entries, new Map(Object.entries(files)));
  expect(graph.errors.size).toBe(0);
  expect(graph.edges.map((e) => [e.source, e.target])).toEqual([
    ["src/App.js", "src/Button.js"],
  ]);
});

it("scopes alias configuration to its project directory rather than its baseUrl", () => {
  const files = {
    "tsconfig.json":
      '{"compilerOptions":{"baseUrl":"src","paths":{"@/*":["*"]}}}',
    "scripts/main.ts": "import {x} from '@/lib';",
    "src/lib.ts": "export const x=1;",
  };
  const entries = Object.keys(files).map(
    (path) => ({ path, type: "file" }) as Entry,
  );
  const graph = buildDependencyGraph(entries, new Map(Object.entries(files)));
  expect(graph.edges.map((e) => [e.source, e.target])).toEqual([
    ["scripts/main.ts", "src/lib.ts"],
  ]);
});
