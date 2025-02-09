import { BuildOptions } from "esbuild";
import { promises as fs, Stats } from "fs";
import { err, ok, Result } from "neverthrow";
import path from "path";
import { DifferSpec, DifferSpecLock, ParseError } from "./differSpec";

export async function parseSpecFile(specFilePath: string): Promise<Result<DifferSpec, ParseError>> {
    const statResult = await checkFileStat(specFilePath);
    if (statResult.isErr()) {
        return err(statResult.error);
    }

    const specContentsResult = await readSpecContents(specFilePath);
    if (specContentsResult.isErr()) {
        return err(specContentsResult.error);
    }

    const specContents = specContentsResult.value;
    const differSpecResult = parseSpecContents(specContents);
    if (differSpecResult.isErr()) {
        return err(differSpecResult.error);
    }

    const differSpec = differSpecResult.value;
    return ok(differSpec);
}

export async function parseSpecLockFile(specFilePath: string): Promise<Result<DifferSpecLock, ParseError>> {
    const specContentsResult = await readSpecContents(specFilePath);

    const specContents = specContentsResult.isErr() ? JSON.stringify({ hashes: {} }) : specContentsResult.value;
    const differSpecLockResult = parseSpecLockContents(specContents);
    const differLockSpec = differSpecLockResult.isErr() ? { hashes: {} } : differSpecLockResult.value;
    
    return ok(differLockSpec);
}

export function resolveFunctionPaths(functions: Record<string, string>, specFileDir: string): Record<string, string> {
    return Object.entries(functions)
        .map(([fxName, fxPath]) => {
            if (path.isAbsolute(fxPath)) {
                return [fxName, fxPath];
            }
            return [fxName, path.resolve(specFileDir, fxPath)];
        })
        .reduce((allFxWithResolvedPaths, fxWithResolvedPath) => {
            const [fxName, resolvedPath] = fxWithResolvedPath;
            allFxWithResolvedPaths[fxName] = resolvedPath;
            return allFxWithResolvedPaths;
        }, <Record<string, string>>{});
}

async function checkFileStat(path: string): Promise<Result<Stats, ParseError>> {
    try {
        const stat = await fs.stat(path);
        return ok(stat);
    } catch (error) {
        return err(new ParseError("file-not-found", `Spec/SpecLock file does not exist: ${path}`));
    }
}

async function readSpecContents(path: string): Promise<Result<string, ParseError>> {
    try {
        const specBuffer = await fs.readFile(path);
        const specContents = specBuffer.toString();
        return ok(specContents);
    } catch (error) {
        return err(new ParseError("file-read-failed", `Spec/SpecLock file does not exist: ${path}`));
    }
}

function parseSpecContents(spec: string): Result<DifferSpec, ParseError> {
    try {
        const parsedSpec = JSON.parse(spec);
        if (!parsedSpec.functions) {
            return err(new ParseError("missing-functions", "No `functions` object found in spec file"));
        }

        return ok(parsedSpec);
    } catch (error) {
        return err(new ParseError("invalid-json", "Failed to parse spec file as JSON"));
    }
}

function parseSpecLockContents(spec: string): Result<DifferSpecLock, ParseError> {
    try {
        const parsedSpec = JSON.parse(spec);
        if (!parsedSpec.hashes) {
            return err(new ParseError("missing-hashes", "No `hashes` object found in spec file"));
        }

        return ok(parsedSpec);
    } catch (error) {
        return err(new ParseError("invalid-json", "Failed to parse spec file as JSON"));
    }
}

export async function parseBundlerConfigFile(path: string): Promise<Result<BuildOptions, ParseError>> {
    if (path === "") {
        return ok({});
    }

    const statResult = await checkFileStat(path);
    if (statResult.isErr()) {
        return err(statResult.error);
    }
    const specContentsResult = await readSpecContents(path);
    if (specContentsResult.isErr()) {
        return err(specContentsResult.error);
    }

    const specContents = specContentsResult.value;
    const bundlerConfigSpecResult = parseBundlerConfig(specContents);
    if (bundlerConfigSpecResult.isErr()) {
        return err(bundlerConfigSpecResult.error);
    }

    const bundlerConfig = bundlerConfigSpecResult.value;
    return ok(bundlerConfig);
}

function parseBundlerConfig(spec: string): Result<BuildOptions, ParseError> {
    try {
        const parsedSpec = JSON.parse(spec);
        return ok(parsedSpec);
    } catch (error) {
        return err(new ParseError("invalid-json", "Failed to parse bundler config spec file as JSON"));
    }
}
