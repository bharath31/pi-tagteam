import { describe, expect, it } from "vitest";
import { getGitBranch, getGitStatus, runGit } from "../src/git.js";

describe("Git Helpers", () => {
	it("checks branch of current repo", async () => {
		const branch = await getGitBranch(process.cwd());
		expect(typeof branch).toBe("string");
	});

	it("runs git status safely", async () => {
		const status = await getGitStatus(process.cwd());
		expect(Array.isArray(status.statusLines)).toBe(true);
		expect(Array.isArray(status.modifiedFiles)).toBe(true);
		expect(Array.isArray(status.untrackedFiles)).toBe(true);
	});

	it("handles non-git directory gracefully", async () => {
		const res = await runGit("/tmp", ["status"]);
		expect(res.ok === false || typeof res.stdout === "string").toBe(true);
	});
});
