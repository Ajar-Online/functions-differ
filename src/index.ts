#!/usr/bin/env node

import chalk from "chalk";
import fs from "fs";
import path from "path";
import { Project } from "ts-morph";
import { BundleResult } from "./bundler/bundleResult";
import { bundleFunction, BundlerConfig } from "./bundler/esbuild";
import hashesDiffer from "./differ/differ";
import calculateHash from "./hasher/hasher";
import segregate from "./hasher/segregate";
import logger from "./logger";
import {
    bundlerConfigFilePath,
    dir,
    discover,
    forceDeploy,
    prefix,
    separator,
    specFilePath,
    specLockFilePath,
    write,
} from "./options/options";
import { DifferSpecLock } from "./parser/differSpec";
import { parseBundlerConfigFile, parseSpecFile, parseSpecLockFile } from "./parser/parser";
import { writeSpecLock } from "./parser/writer";

async function main() {
    logger.info(discover);
    // TODO discover disabled for now as it doesnt work as expected
    // if (discover && false) {
    //     logger.info(
    //         `Automatic function discover enabled. Trying to discover functions automatically. IndexFilePath: ${indexFilePath}`,
    //     );
    //     const functionsPath = getFirebaseFunctionsAndPaths(indexFilePath ?? undefined);
    //     logger.info(`Discovered ${Object.keys(functionsPath).length} functions`);
    //     logger.info(`Writing spec file`);
    //     const specResult = await parseSpecFile(specFilePath);

    //     if (specResult.isErr()) {
    //         logger.info("Spec file not found or invalid. Writing spec file");
    //         await writeSpec({ functions: { ...functionsPath } }, specFilePath);
    //     } else {
    //         const spec = specResult.value;
    //         spec.functions = functionsPath;
    //         await writeSpec(spec, specFilePath);
    //     }
    // }
    logger.info(`Parsing ${specFilePath}`);
    const specResult = await parseSpecFile(specFilePath);
    if (specResult.isErr()) {
        logger.error(specResult.error);
        return;
    }

    logger.info(`Parsing ${specLockFilePath}`);
    const specLockResult = await parseSpecLockFile(specLockFilePath);
    if (specLockResult.isErr()) {
        logger.error(specLockResult.error);
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

    const { functions } = specResult.value;
    let { hashes: existingHashes } = specLockResult.value;
    logger.info(`Discovered ${Object.keys(functions).length} functions`);

    const bundleResult = await processCloudFunctionsBuild(functions, bundlerConfig);

    const bundles = bundleResult.value;
    const hashResults = bundles.map(({ fxName, code }) => {
        // debug builded files

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

    existingHashes = forceDeploy ? {} : existingHashes;
    const diffResults = hashesDiffer(existingHashes ?? {}, newHashes);

    const updatedSpecLock: DifferSpecLock = {
        hashes: newHashes,
        lastDiff: diffResults,
    };

    Object.entries(newHashes).forEach(([fxName, fxHash]) => {
        logger.info(`${chalk.blue(fxName)}: ${chalk.green(fxHash)}`);
    });

    Object.entries(diffResults).forEach(([diffComponent, componentResults]) => {
        logger.info(`${chalk.yellow(diffComponent)}: ${chalk.green(componentResults)}`);
    });

    // write .differspec.json and .differspec.lock.json
    if (write) {
        // const writeResult = await writeSpec(updatedSpec, specFilePath);
        // if (writeResult.isErr()) {
        //     const error = writeResult.error;
        //     logger.error("Failed to update .differspec.json", error);
        // }

        const writeLockResult = await writeSpecLock(updatedSpecLock, specLockFilePath);
        if (writeLockResult.isErr()) {
            const error = writeLockResult.error;
            logger.error("Failed to update .differspec.lock.json", error);
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
    logger.info("Starting processing");

    const bundleResult: { value: BundleResult[] } = { value: [] };
    const project = new Project();

    // resolve paths
    Object.entries(functions).forEach(([funcName, funcPath]) => {
        functions[funcName] = path.isAbsolute(funcPath) ? funcPath : path.resolve(dir ?? "", funcPath);
    });

    project.addSourceFilesAtPaths(Object.values(functions));

    type sourceFileType = ReturnType<typeof project.getSourceFile>;
    const sourceFilesCache: { [key: string]: sourceFileType } = {};

    project.getSourceFiles().forEach((s) => (sourceFilesCache[s.getFilePath()] = s.getSourceFile()));

    const exportSymbolsCache: { [key: string]: any } = {};

    for (const [name, filePath] of Object.entries(functions)) {
        logger.info("Processing cloud function:", name, "Path:", filePath);

        const sourceFile = sourceFilesCache[filePath]!;

        if (!exportSymbolsCache[filePath]) {
            exportSymbolsCache[filePath] = sourceFile.getExportSymbols();
        }

        const exportSymbols = exportSymbolsCache[filePath];
        const names = exportSymbols.map((e: any) => e.getEscapedName());

        const escapedFName = name.split("-").pop();

        if (escapedFName && names.includes(escapedFName)) {
            const index = names.indexOf(escapedFName);
            names.splice(index, 1);

            // remove all other cloud functions from the file, except the one we want to compile
            for (const n of names) {
                const f = sourceFile.getVariableDeclaration(n);

                if (f) {
                    f.remove();
                }
            }
        }

        const [p, ext] = filePath.split(/.(\w+)$/);
        const newFilePath = `${p}[-]${name}[-].${ext}`;

        // save single cloud function in a file (with other cloud functions removed)
        await sourceFile.copyImmediately(newFilePath, { overwrite: true });

        // build file
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
