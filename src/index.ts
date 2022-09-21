#!/usr/bin/env node

import chalk from "chalk";
import fs from "fs";
import path from "path";
import { Project } from "ts-morph";
import { BundleResult } from "./bundler/bundleResult";
import { bundleFunction, BundlerConfig } from "./bundler/esbuild";
import hashesDiffer from "./differ/differ";
import { getFirebaseFunctionsAndPaths } from "./discoverer/discoverer";
import calculateHash from "./hasher/hasher";
import segregate from "./hasher/segregate";
import logger from "./logger";
import {
    bundlerConfigFilePath,
    discover,
    forceDeploy,
    indexFilePath,
    prefix,
    separator,
    specFilePath,
    write,
} from "./options/options";
import DifferSpec from "./parser/differSpec";
import parseSpecFile, { parseBundlerConfigFile } from "./parser/parser";
import writeSpec from "./parser/writer";

async function main() {
    logger.info(discover);
    if (discover) {
        logger.info(
            `Automatic function discover enabled. Trying to discover functions automatically. IndexFilePath: ${indexFilePath}`,
        );
        const functionsPath = getFirebaseFunctionsAndPaths(indexFilePath ?? undefined);
        logger.info(`Discovered ${Object.keys(functionsPath).length} functions`);
        logger.info(`Writing spec file`);
        const specResult = await parseSpecFile(specFilePath);

        if (specResult.isErr()) {
            logger.info("Spec file not found or invalid. Writing spec file");
            await writeSpec({ functions: { ...functionsPath } }, specFilePath);
        } else {
            const spec = specResult.value;
            spec.functions = functionsPath;
            await writeSpec(spec, specFilePath);
        }
    }
    logger.info(`Parsing ${specFilePath}`);
    const specResult = await parseSpecFile(specFilePath);
    if (specResult.isErr()) {
        logger.error(specResult.error);
        return;
    }

    const bundlerConfigSpecResult = await parseBundlerConfigFile(bundlerConfigFilePath);
    if (bundlerConfigSpecResult.isErr()) {
        logger.error(bundlerConfigSpecResult.error);
        return;
    }
    const bundlerConfig: BundlerConfig = {
        ...bundlerConfigSpecResult.value,
        // concurrency,
    };

    const { functions, hashes: existingHashes } = specResult.value;
    logger.info(`Discovered ${Object.keys(functions).length} functions`);

    const bundleResult = await processCloudFunctionsBuild(functions, bundlerConfig);

    // const bundleResult = await bundleFunctions(fxWithResolvedPaths, bundlerConfig);
    // if (bundleResult.isErr()) {
    //     logger.error("Encountered an error while bundling functions", bundleResult.error);
    //     return;
    // }

    const bundles = bundleResult.value;
    const hashResults = bundles.map(({ fxName, code }) => {
        // const file = cwd() + "/code/" + fxName + ".js";
        // try {
        //     fs.mkdirSync(path.dirname(file));
        // } catch (error) {}
        // fs.writeFileSync(file, code, { flag: "w" });
        return calculateHash(fxName, code);
    });
    const [hashes, hashErrors] = segregate(hashResults);

    if (hashErrors.length != 0) {
        logger.error(`Encountered ${hashErrors.length} while hashing functions`);
        hashErrors.forEach((err) => logger.error(err.error));
        return;
    }

    const newHashes = hashes
        .map((hash) => hash.value)
        .reduce((record, { fxName, hash }) => {
            record[fxName] = hash;
            return record;
        }, <Record<string, string>>{});

    const diffResults = hashesDiffer((forceDeploy ? {} : existingHashes) ?? {}, newHashes);

    const updatedSpec: DifferSpec = {
        functions,
        hashes: newHashes,
        lastDiff: diffResults,
    };

    Object.entries(newHashes).forEach(([fxName, fxHash]) => {
        logger.info(`${chalk.blue(fxName)}: ${chalk.green(fxHash)}`);
    });

    Object.entries(diffResults).forEach(([diffComponent, componentResults]) => {
        logger.info(`${chalk.yellow(diffComponent)}: ${chalk.green(componentResults)}`);
    });

    if (write) {
        const writeResult = await writeSpec(updatedSpec, specFilePath);
        if (writeResult.isErr()) {
            const error = writeResult.error;
            logger.error("Failed to update .differspec.json", error);
        }
    }

    const functionsToRedeploy = [...diffResults.added, ...diffResults.changed]
        .map((fxName) => `${prefix}${fxName}`)
        .join(separator);

    console.log(functionsToRedeploy);
}

export const kill = () => {
    logger.info("KILLED PROCESS");
    process.kill(process.pid, "SIGINT");
};

const processCloudFunctionsBuild = async (
    functions: Record<string, string>,
    bundlerConfig: BundlerConfig,
): Promise<{ value: BundleResult[] }> => {
    const bundleResult: { value: BundleResult[] } = { value: [] };
    const project = new Project();
    const functionsKeys = Object.values(functions);

    project.addSourceFilesAtPaths(functionsKeys);

    // const symbolFn = project.getSourceFile(functionsKeys[0])!.getSymbol;
    type sourceFileType = ReturnType<typeof project.getSourceFile>;
    // type symbolType = ReturnType<typeof symbolFn>;
    const sourceFiles: { [key: string]: sourceFileType } = {};

    project.getSourceFiles().forEach((s) => (sourceFiles[s.getFilePath()] = s.getSourceFile()));

    // const typeChecker = project.getTypeChecker();
    const exportSymbolsCache: { [key: string]: any } = {};

    for (const [name, filePath] of Object.entries(functions)) {
        const absoluteFilePath = path.resolve(filePath);

        logger.log("Processing cloud function:", name, "Path:", absoluteFilePath);

        const sourceFile = sourceFiles[absoluteFilePath]!;

        if (sourceFile == null) {
            throw new Error("Source file not found: " + absoluteFilePath);
        }

        if (!exportSymbolsCache[absoluteFilePath]) {
            exportSymbolsCache[absoluteFilePath] = sourceFile.getExportSymbols();
        }

        const exportSymbols = exportSymbolsCache[absoluteFilePath];
        const names = exportSymbols.map((e: any) => e.getEscapedName());

        const escapedFName = name.split("-").pop();

        if (escapedFName && names.includes(escapedFName)) {
            const index = names.indexOf(escapedFName);
            names.splice(index, 1);

            // remove all other functions from the file, except the one we want to compile
            for (const n of names) {
                const f = sourceFile.getVariableDeclaration(n);

                if (f) {
                    f.remove();
                }
            }
        }

        const [p, ext] = absoluteFilePath.split(/.(\w+)$/);
        const newFilePath = `${p}[-]${name}[-].${ext}`;
        await sourceFile.copyImmediately(newFilePath, { overwrite: true });

        const result = await bundleFunction(name, newFilePath, bundlerConfig);

        bundleResult.value.push(result);

        fs.unlink(newFilePath, (err) => {
            if (err) {
                logger.error(err);
            }
        });
    }

    return bundleResult;
};

main();
