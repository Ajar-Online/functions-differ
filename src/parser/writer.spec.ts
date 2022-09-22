import { expect } from "chai";
import { DifferSpec, DifferSpecLock } from "./differSpec";
import { createTempFile } from "./parser.spec";
import prettify from "./prettify";
import { writeSpec, writeSpecLock } from "./writer";

describe("spec writer", () => {
    it("should write pretty JSON into the spec file", async () => {
        const spec: DifferSpec = { functions: {} };
        const spacing = 2;

        const [file, cleanup] = await createTempFile();
        const writtenContentsResult = await writeSpec(spec, file, spacing);

        expect(writtenContentsResult.isOk()).to.be.true;

        const writtenContents = writtenContentsResult._unsafeUnwrap();
        const expectedContents = prettify(spec, spacing);
        expect(writtenContents).to.equal(expectedContents);

        await cleanup();
    });
});

describe("spec writer lock", () => {
    it("should write pretty JSON into the spec lock file", async () => {
        const spec: DifferSpecLock = { hashes: {} };
        const spacing = 2;

        const [file, cleanup] = await createTempFile();
        const writtenContentsResult = await writeSpecLock(spec, file, spacing);

        expect(writtenContentsResult.isOk()).to.be.true;

        const writtenContents = writtenContentsResult._unsafeUnwrap();
        const expectedContents = prettify(spec, spacing);
        expect(writtenContents).to.equal(expectedContents);

        await cleanup();
    });
});
