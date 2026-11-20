import { readdir, readFile, stat } from "node:fs/promises";
import { join, posix } from "node:path";
import ts from "typescript";
import { AppError, nowIso } from "@freebuff/shared";

/** Repository indexer producing a symbol graph for agent context queries. */

export type SymbolKind =
  | "function"
  | "class"
  | "interface"
  | "type"
  | "enum"
  | "variable"
  | "method";

export interface IndexedSymbol {
  readonly name: string;
  readonly kind: SymbolKind;
  readonly file: string;
  readonly line: number;
  readonly exported: boolean;
  readonly signature?: string;
}

export interface ImportEdge {
  readonly from: string;
  readonly specifier: string;
  readonly to?: string;
  readonly names: readonly string[];
}

export interface FileEntry {
  readonly path: string;
  readonly lines: number;
  readonly symbols: readonly IndexedSymbol[];
  readonly imports: readonly ImportEdge[];
  readonly exports: readonly string[];
  readonly identifiers: readonly string[];
}

export interface CodeMapIndex {
  readonly root: string;
  readonly files: readonly FileEntry[];
  readonly symbols: readonly IndexedSymbol[];
  readonly edges: readonly ImportEdge[];
  readonly builtAt: string;
  readonly truncated: boolean;
}

export interface IndexOptions {
  readonly maxFiles?: number;
  readonly exclude?: readonly string[];
}

const SOURCE_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
] as const;

const DEFAULT_EXCLUDED = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "out",
  "coverage",
  ".next",
  ".open-next",
  ".turbo",
  ".cache",
  "vendor",
]);

const DEFAULT_MAX_FILES = 5000;

const isSourceFile = (name: string): boolean =>
  SOURCE_EXTENSIONS.some((extension) => name.endsWith(extension));

const walk = async (
  root: string,
  directory: string,
  excluded: ReadonlySet<string>,
  files: string[],
  maxFiles: number,
): Promise<boolean> => {
  const entries = await readdir(join(root, directory), { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (excluded.has(entry.name)) {
        continue;
      }
      const truncated = await walk(
        root,
        directory.length === 0 ? entry.name : `${directory}/${entry.name}`,
        excluded,
        files,
        maxFiles,
      );
      if (truncated) {
        return true;
      }
      continue;
    }
    if (!entry.isFile() || !isSourceFile(entry.name)) {
      continue;
    }
    if (files.length >= maxFiles) {
      return true;
    }
    files.push(directory.length === 0 ? entry.name : `${directory}/${entry.name}`);
  }
  return false;
};

const scriptKindFor = (filePath: string): ts.ScriptKind => {
  if (filePath.endsWith(".tsx")) {
    return ts.ScriptKind.TSX;
  }
  if (filePath.endsWith(".jsx")) {
    return ts.ScriptKind.JSX;
  }
  if (filePath.endsWith(".js") || filePath.endsWith(".mjs") || filePath.endsWith(".cjs")) {
    return ts.ScriptKind.JS;
  }
  return ts.ScriptKind.TS;
};

const hasExport = (node: ts.Node): boolean => {
  const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
  return modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false;
};

const declarationName = (node: ts.Node): string | undefined => {
  if (
    ts.isFunctionDeclaration(node) ||
    ts.isClassDeclaration(node) ||
    ts.isInterfaceDeclaration(node) ||
    ts.isTypeAliasDeclaration(node) ||
    ts.isEnumDeclaration(node) ||
    ts.isMethodDeclaration(node)
  ) {
    return node.name?.getText();
  }
  return undefined;
};

const kindOf = (node: ts.Node): SymbolKind | undefined => {
  if (ts.isFunctionDeclaration(node)) {
    return "function";
  }
  if (ts.isClassDeclaration(node)) {
    return "class";
  }
  if (ts.isInterfaceDeclaration(node)) {
    return "interface";
  }
  if (ts.isTypeAliasDeclaration(node)) {
    return "type";
  }
  if (ts.isEnumDeclaration(node)) {
    return "enum";
  }
  if (ts.isMethodDeclaration(node)) {
    return "method";
  }
  return undefined;
};

interface ParsedFile {
  readonly symbols: IndexedSymbol[];
  readonly imports: ImportEdge[];
  readonly exports: string[];
  readonly identifiers: string[];
  readonly lines: number;
}

const parseFile = (filePath: string, sourceText: string): ParsedFile => {
  const sourceFile = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    scriptKindFor(filePath),
  );
  const symbols: IndexedSymbol[] = [];
  const imports: ImportEdge[] = [];
  const exports: string[] = [];
  const identifiers = new Set<string>();

  const lineOf = (node: ts.Node): number =>
    sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;

  const signatureOf = (node: ts.Node): string => {
    const body = (node as { readonly body?: ts.Node }).body;
    const end = body === undefined ? node.getEnd() : body.getStart(sourceFile);
    const text = sourceText.slice(node.getStart(sourceFile), end).replace(/\s+/g, " ").trim();
    return text.length > 240 ? `${text.slice(0, 237)}...` : text;
  };

  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) {
      identifiers.add(node.text);
    }
    if (ts.isImportDeclaration(node)) {
      const specifier = ts.isStringLiteral(node.moduleSpecifier)
        ? node.moduleSpecifier.text
        : "";
      const names: string[] = [];
      const clause = node.importClause;
      if (clause?.name !== undefined) {
        names.push(clause.name.text);
      }
      if (clause?.namedBindings !== undefined && ts.isNamedImports(clause.namedBindings)) {
        for (const element of clause.namedBindings.elements) {
          names.push(element.name.text);
        }
      }
      if (specifier.length > 0) {
        imports.push({ from: filePath, specifier, names });
      }
    }
    if (ts.isExportDeclaration(node) && node.moduleSpecifier !== undefined) {
      const specifier = ts.isStringLiteral(node.moduleSpecifier)
        ? node.moduleSpecifier.text
        : "";
      if (specifier.length > 0) {
        imports.push({ from: filePath, specifier, names: [] });
      }
    }
    const kind = kindOf(node);
    const name = declarationName(node);
    if (kind !== undefined && name !== undefined) {
      const exported = hasExport(node);
      if (exported) {
        exports.push(name);
      }
      symbols.push({
        name,
        kind,
        file: filePath,
        line: lineOf(node),
        exported,
        signature: signatureOf(node),
      });
    }
    if (ts.isVariableStatement(node)) {
      const exported = hasExport(node);
      for (const declaration of node.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) {
          const name = declaration.name.text;
          if (exported) {
            exports.push(name);
          }
          symbols.push({
            name,
            kind: "variable",
            file: filePath,
            line: lineOf(declaration),
            exported,
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return {
    symbols,
    imports,
    exports,
    identifiers: [...identifiers],
    lines: sourceFile.getLineAndCharacterOfPosition(sourceText.length).line + 1,
  };
};

const resolveSpecifier = (
  fromFile: string,
  specifier: string,
  existing: ReadonlySet<string>,
): string | undefined => {
  if (!specifier.startsWith(".")) {
    return undefined;
  }
  const base = posix.normalize(posix.join(posix.dirname(fromFile), specifier));
  const candidates = [
    base,
    ...SOURCE_EXTENSIONS.map((extension) => `${base}${extension}`),
    ...SOURCE_EXTENSIONS.map((extension) => `${base}/index${extension}`),
  ];
  return candidates.find((candidate) => existing.has(candidate));
};

/** Indexes a repository. Files that fail to read are skipped, never fatal. */
export const indexRepository = async (
  root: string,
  options: IndexOptions = {},
): Promise<CodeMapIndex> => {
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
  const excluded = new Set<string>([
    ...DEFAULT_EXCLUDED,
    ...(options.exclude ?? []),
  ]);

  let rootStat;
  try {
    rootStat = await stat(root);
  } catch (error) {
    throw new AppError({
      code: "not_found",
      message: `Cannot index ${root}: path does not exist`,
      cause: error,
    });
  }
  if (!rootStat.isDirectory()) {
    throw new AppError({
      code: "validation_failed",
      message: `Cannot index ${root}: not a directory`,
    });
  }

  const paths: string[] = [];
  const truncated = await walk(root, "", excluded, paths, maxFiles);
  const existing = new Set(paths);

  const files: FileEntry[] = [];
  const edges: ImportEdge[] = [];
  const symbols: IndexedSymbol[] = [];

  for (const filePath of paths) {
    let sourceText: string;
    try {
      sourceText = await readFile(join(root, filePath), "utf8");
    } catch {
      continue;
    }
    const parsed = parseFile(filePath, sourceText);
    const resolvedImports: ImportEdge[] = parsed.imports.map((edge) => {
      const to = resolveSpecifier(filePath, edge.specifier, existing);
      return to === undefined ? edge : { ...edge, to };
    });
    files.push({
      path: filePath,
      lines: parsed.lines,
      symbols: parsed.symbols,
      imports: resolvedImports,
      exports: parsed.exports,
      identifiers: parsed.identifiers,
    });
    edges.push(...resolvedImports);
    symbols.push(...parsed.symbols);
  }

  return {
    root,
    files,
    symbols,
    edges,
    builtAt: nowIso(),
    truncated,
  };
};
