import cmdArgs, { OptionDefinition } from "command-line-args";
import path from "path";

export const options: OptionDefinition[] = [
    { name: "dir", alias: "d", type: String, defaultValue: process.cwd() },
    { name: "write", alias: "w", type: Boolean, defaultValue: true },
    { name: "verbose", alias: "v", type: Boolean, defaultValue: false },
    { name: "prefix", type: String, defaultValue: "functions:" },
    { name: "sep", type: String, defaultValue: "," },
    { name: "bundlerConfig", type: String, defaultValue: "" },
    { name: "concurrency", type: Number },
    { name: "discover", type: Boolean, defaultValue: true },
    { name: "no-discover", type: Boolean },
    { name: "indexFilePath", type: String, defaultValue: undefined },
    { name: "forceDeploy", type: Boolean, defaultValue: false },
];

const args = cmdArgs(options, { partial: true });
const { dir, write, verbose, prefix, sep: separator, bundlerConfig, concurrency, indexFilePath, forceDeploy } = args;
const discover = args.discover && !args["no-discover"];

if (!dir) {
    console.error("Error: dir argument not supplied");
    process.exit(1);
}

const specFilePath: string = path.join(dir, ".differspec.json");
const specLockFilePath: string = path.join(dir, ".differspec.lock.json");
const bundlerConfigFilePath: string = bundlerConfig ? path.join(dir, bundlerConfig) : "";

console.info("Arguments:");
Object.entries(args as { [key: string]: any }).map(([key, value]) => {
    console.log(`${key} = '${JSON.stringify(value)}'`);
});

export {
    specFilePath,
    specLockFilePath,
    dir,
    write,
    verbose,
    prefix,
    separator,
    bundlerConfigFilePath,
    concurrency,
    discover,
    indexFilePath,
    forceDeploy,
};
