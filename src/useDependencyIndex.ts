import { useEffect, useMemo, useState } from "react";
import type { MutableRefObject } from "react";
import type { Repository } from "./types";
import { readFile } from "./api";
import { buildDependencyGraph, isSource } from "./dependencies";

export default function useDependencyIndex(
  repo: Repository,
  cache: MutableRefObject<Map<string, string>>,
) {
  const [state, setState] = useState({
    repoId: repo.id,
    contents: new Map<string, string>(),
    done: 0,
    total: 0,
    failed: [] as string[],
    loading: true,
  });
  const [limit, setLimit] = useState(160);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    setLimit(160);
  }, [repo.id]);
  useEffect(() => {
    const controller = new AbortController();
    const candidates = repo.entries.filter(
      (e) => e.type === "file" && isSource(e.path),
    );
    const tasks = candidates.slice(0, limit);
    const configs = repo.entries
      .filter(
        (e) =>
          e.type === "file" &&
          /(^|\/)(tsconfig|jsconfig)(?:\.[^/]+)?\.json$/.test(e.path),
      )
      .slice(0, 12);
    const contents = new Map<string, string>();
    const failed: string[] = [];
    let done = 0,
      next = 0;
    const publish = (loading: boolean) => {
      if (!controller.signal.aborted)
        setState({
          repoId: repo.id,
          contents: new Map(contents),
          done,
          total: candidates.length,
          failed: [...failed],
          loading,
        });
    };
    const load = async (entry: (typeof tasks)[number]) => {
      const key = `${repo.id}:${entry.path}`;
      let source = cache.current.get(key);
      if (source === undefined) {
        source = await readFile(repo, entry, controller.signal);
        if (controller.signal.aborted) return;
        cache.current.set(key, source);
      }
      contents.set(entry.path, source);
    };
    publish(true);
    const run = async () => {
      await Promise.all(configs.map((e) => load(e).catch(() => {})));
      await Promise.all(
        Array.from({ length: 4 }, async () => {
          while (next < tasks.length && !controller.signal.aborted) {
            const entry = tasks[next++];
            try {
              await load(entry);
            } catch (e) {
              if (!controller.signal.aborted)
                failed.push(`${entry.path}: ${(e as Error).message}`);
            }
            done++;
            if (done % 4 === 0) publish(true);
          }
        }),
      );
      publish(false);
    };
    void run();
    return () => controller.abort();
  }, [repo, cache, limit, attempt]);
  const current =
    state.repoId === repo.id
      ? state
      : {
          ...state,
          contents: new Map<string, string>(),
          done: 0,
          loading: true,
          failed: [],
        };
  const graph = useMemo(
    () => buildDependencyGraph(repo.entries, current.contents),
    [repo.entries, current.contents],
  );
  return {
    ...current,
    graph,
    continueScan: () => setLimit((n) => n + 160),
    retry: () => setAttempt((n) => n + 1),
  };
}
