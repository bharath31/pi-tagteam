import { describe, expect, it } from "vitest";
import { discoverClaudeSessions, discoverCodexSessions, discoverSessions } from "../src/discovery.js";

describe("Session Discovery", () => {
	it("discovers Claude sessions across projects or for current directory", async () => {
		const sessions = await discoverClaudeSessions({
			cwd: process.cwd(),
			maxAgeHours: 24 * 30, // 30 days
			allProjects: true,
		});

		expect(Array.isArray(sessions)).toBe(true);
		// If there are any claude sessions on the machine, verify their properties
		if (sessions.length > 0) {
			const first = sessions[0];
			expect(first.tool).toBe("claude");
			expect(typeof first.id).toBe("string");
			expect(typeof first.mtime).toBe("number");
			expect(typeof first.file).toBe("string");
		}
	});

	it("discovers Codex sessions across projects or for current directory", async () => {
		const sessions = await discoverCodexSessions({
			cwd: process.cwd(),
			maxAgeHours: 24 * 30,
			allProjects: true,
		});

		expect(Array.isArray(sessions)).toBe(true);
		if (sessions.length > 0) {
			const first = sessions[0];
			expect(first.tool).toBe("codex");
			expect(typeof first.id).toBe("string");
			expect(typeof first.mtime).toBe("number");
		}
	});

	it("runs unified discoverSessions", async () => {
		const all = await discoverSessions({
			cwd: process.cwd(),
			tool: "both",
			maxAgeHours: 24 * 30,
			allProjects: true,
			maxResults: 5,
		});

		expect(Array.isArray(all)).toBe(true);
		expect(all.length).toBeLessThanOrEqual(5);
	});
});
