import { describe, expect, it } from "vitest";
import { RepositoryCodeMap, indexRepository } from "@freebuff/code-map";
import { createFixtureRepo } from "../../support/fixture-repo";

const FILES = {
  "src/a.ts": [
    "export interface Shape {",
    "  area(): number;",
    "}",
    "",
    "export const square = (side: number): number => side * side;",
    "",
  ].join("\n"),
  "src/b.ts": [
    'import { square } from "./a";',
    "",
    "export function total(items: number[]): number {",
    "  return items.reduce((sum, item) => sum + square(item), 0);",
    "}",
    "",
  ].join("\n"),
  "src/c.ts": [
    'import { total } from "./b";',
    "",
    "export class Report {",
    "  constructor(private readonly values: number[]) {}",
    "",
    "  render(): string {",
    "    return String(total(this.values));",
    "  }",
    "}",
    "",
  ].join("\n"),
};

describe("code map indexer", () => {
  it("indexes symbols, imports and dependents", async () => {
    const repo = await createFixtureRepo(FILES);
    try {
      const index = await indexRepository(repo.root);
      expect(index.files).toHaveLength(3);
      expect(index.truncated).toBe(false);

      const names = index.symbols.map((symbol) => symbol.name);
      expect(names).toContain("square");
      expect(names).toContain("total");
      expect(names).toContain("Report");
      expect(names).toContain("Shape");

      const edge = index.edges.find((candidate) => candidate.from === "src/b.ts");
      expect(edge?.to).toBe("src/a.ts");
      expect(edge?.names).toContain("square");
    } finally {
      await repo.cleanup();
    }
  });

  it("answers outline, definition, reference and dependency queries", async () => {
    const repo = await createFixtureRepo(FILES);
    try {
      const codeMap = await RepositoryCodeMap.load(repo.root);

      expect(codeMap.outline("src/c.ts").map((symbol) => symbol.name)).toEqual([
        "Report",
        "render",
      ]);
      expect(codeMap.definitions("total").map((symbol) => symbol.file)).toEqual([
        "src/b.ts",
      ]);
      expect(
        codeMap.references("total").map((reference) => reference.file).sort(),
      ).toEqual(["src/b.ts", "src/c.ts"]);
      expect(codeMap.dependents("src/a.ts").map((edge) => edge.from)).toEqual([
        "src/b.ts",
      ]);
      expect(codeMap.dependencies("src/c.ts").map((edge) => edge.to)).toEqual([
        "src/b.ts",
      ]);
      expect(codeMap.search("squ").map((symbol) => symbol.name)).toEqual(["square"]);
      expect(codeMap.stats()).toEqual({
        files: 3,
        symbols: expect.any(Number),
        edges: 2,
        truncated: false,
      });
    } finally {
      await repo.cleanup();
    }
  });

  it("rejects a missing root instead of returning an empty index", async () => {
    await expect(indexRepository("/definitely/not/here")).rejects.toThrow(
      /does not exist/,
    );
  });
});
