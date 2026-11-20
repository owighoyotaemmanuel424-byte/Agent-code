import { indexRepository } from "./indexer";
import type { CodeMapIndex, FileEntry, ImportEdge, IndexedSymbol, IndexOptions } from "./indexer";

export interface SymbolReference {
  readonly file: string;
  readonly count: number;
}

/** Query facade handed to the agent's code-map tool. */
export class RepositoryCodeMap {
  constructor(private readonly index: CodeMapIndex) {}

  static async load(root: string, options: IndexOptions = {}): Promise<RepositoryCodeMap> {
    return new RepositoryCodeMap(await indexRepository(root, options));
  }

  get snapshot(): CodeMapIndex {
    return this.index;
  }

  files(): string[] {
    return this.index.files.map((file) => file.path);
  }

  fileEntry(file: string): FileEntry | undefined {
    const normalised = file.replace(/^\.\//, "");
    return this.index.files.find((entry) => entry.path === normalised);
  }

  outline(file: string): IndexedSymbol[] {
    const entry = this.fileEntry(file);
    return entry === undefined
      ? []
      : entry.symbols.filter((symbol) => symbol.kind !== "variable");
  }

  definitions(name: string): IndexedSymbol[] {
    return this.index.symbols.filter((symbol) => symbol.name === name);
  }

  references(name: string): SymbolReference[] {
    const references: SymbolReference[] = [];
    for (const file of this.index.files) {
      const count = file.identifiers.filter((identifier) => identifier === name).length;
      if (count > 0) {
        references.push({ file: file.path, count });
      }
    }
    return references;
  }

  dependencies(file: string): ImportEdge[] {
    return this.index.edges.filter((edge) => edge.from === file);
  }

  dependents(file: string): ImportEdge[] {
    return this.index.edges.filter((edge) => edge.to === file);
  }

  search(query: string, limit = 20): IndexedSymbol[] {
    const needle = query.toLowerCase();
    return this.index.symbols
      .filter((symbol) => symbol.name.toLowerCase().includes(needle))
      .slice(0, limit);
  }

  stats(): {
    readonly files: number;
    readonly symbols: number;
    readonly edges: number;
    readonly truncated: boolean;
  } {
    return {
      files: this.index.files.length,
      symbols: this.index.symbols.length,
      edges: this.index.edges.length,
      truncated: this.index.truncated,
    };
  }
}

/** Structural interface consumed by the agent tool, keeping the tool decoupled. */
export interface CodeMapQuery {
  readonly files: () => string[];
  readonly outline: (file: string) => IndexedSymbol[];
  readonly definitions: (name: string) => IndexedSymbol[];
  readonly references: (name: string) => SymbolReference[];
  readonly dependencies: (file: string) => ImportEdge[];
  readonly dependents: (file: string) => ImportEdge[];
  readonly search: (query: string, limit?: number) => IndexedSymbol[];
  readonly stats: () => {
    readonly files: number;
    readonly symbols: number;
    readonly edges: number;
    readonly truncated: boolean;
  };
}
