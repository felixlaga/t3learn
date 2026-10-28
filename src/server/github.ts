/**
 * A small GitHub client for the automatic backup (backup wave, owner
 * 2026-10-28): the REST calls the sync needs and the OAuth device flow,
 * over the global fetch — no git binary, no gh, no SDK. Every call is
 * injectable (fetch + both bases) so the tests run it against a loopback
 * fake of GitHub.
 *
 * Git Data API, in the order a push uses it: read the branch head, read
 * its commit's tree, create blobs, create a tree (optionally on a base
 * tree with deletions as sha null), create a commit, move the ref — a
 * fast-forward only, never force.
 */

export class GitHubError extends Error {
	constructor(
		readonly status: number,
		message: string,
	) {
		super(message);
		this.name = "GitHubError";
	}
}

export interface GitHubClientOptions {
	token: string;
	fetch?: typeof fetch;
	/** api.github.com */
	apiBase?: string;
}

export interface TreeEntry {
	path: string;
	mode: "100644";
	type: "blob";
	/** A blob sha, or null to delete the path (only with a base tree). */
	sha: string | null;
}

const USER_AGENT = "T3Learn-backup";

export function createGitHubClient({ token, fetch: doFetch = fetch, apiBase = "https://api.github.com" }: GitHubClientOptions) {
	async function call<T>(method: string, route: string, body?: unknown, allow404 = false): Promise<T | null> {
		const res = await doFetch(`${apiBase}${route}`, {
			method,
			headers: {
				accept: "application/vnd.github+json",
				authorization: `Bearer ${token}`,
				"x-github-api-version": "2022-11-28",
				"user-agent": USER_AGENT,
				...(body !== undefined ? { "content-type": "application/json" } : {}),
			},
			body: body !== undefined ? JSON.stringify(body) : undefined,
		});
		if (res.status === 404 && allow404) return null;
		if (res.status === 409 && allow404) return null; // an empty repository answers 409 on refs
		const text = await res.text();
		if (!res.ok) {
			let message = text;
			try {
				const parsed = JSON.parse(text) as { message?: string };
				if (parsed?.message) message = parsed.message;
			} catch {
				/* keep the raw body */
			}
			throw new GitHubError(res.status, `GitHub ${method} ${route}: ${res.status} ${message}`.trim());
		}
		return text ? (JSON.parse(text) as T) : ({} as T);
	}

	return {
		/** The token's account. */
		async me(): Promise<{ login: string }> {
			const user = await call<{ login: string }>("GET", "/user");
			if (!user?.login) throw new GitHubError(500, "GitHub /user answered without a login");
			return { login: user.login };
		},
		/** The repository, or null when it does not exist (or is invisible to the token). */
		async getRepo(owner: string, name: string): Promise<{ private: boolean; fullName: string; defaultBranch: string; htmlUrl: string } | null> {
			const repo = await call<{ private: boolean; full_name: string; default_branch: string; html_url: string }>("GET", `/repos/${owner}/${name}`, undefined, true);
			if (!repo) return null;
			return { private: repo.private === true, fullName: repo.full_name, defaultBranch: repo.default_branch || "main", htmlUrl: repo.html_url };
		},
		/** Create a PRIVATE repository on the token's account. */
		async createRepo(name: string): Promise<{ private: boolean; fullName: string; defaultBranch: string; htmlUrl: string }> {
			const repo = await call<{ private: boolean; full_name: string; default_branch: string; html_url: string }>("POST", "/user/repos", {
				name,
				private: true,
				auto_init: false,
				has_issues: false,
				has_projects: false,
				has_wiki: false,
				description: "Private T3Learn learning backup",
			});
			return { private: repo!.private === true, fullName: repo!.full_name, defaultBranch: repo!.default_branch || "main", htmlUrl: repo!.html_url };
		},
		/** The branch head sha, or null for a missing branch / empty repository. */
		async getHead(owner: string, name: string, branch: string): Promise<string | null> {
			const ref = await call<{ object?: { sha?: string } }>("GET", `/repos/${owner}/${name}/git/ref/heads/${encodeURIComponent(branch)}`, undefined, true);
			return ref?.object?.sha ?? null;
		},
		async getCommitTree(owner: string, name: string, sha: string): Promise<string> {
			const commit = await call<{ tree: { sha: string } }>("GET", `/repos/${owner}/${name}/git/commits/${sha}`);
			return commit!.tree.sha;
		},
		async createBlob(owner: string, name: string, content: Buffer): Promise<string> {
			const blob = await call<{ sha: string }>("POST", `/repos/${owner}/${name}/git/blobs`, { content: content.toString("base64"), encoding: "base64" });
			return blob!.sha;
		},
		async createTree(owner: string, name: string, tree: TreeEntry[], baseTree?: string): Promise<string> {
			const created = await call<{ sha: string }>("POST", `/repos/${owner}/${name}/git/trees`, { tree, ...(baseTree ? { base_tree: baseTree } : {}) });
			return created!.sha;
		},
		async createCommit(owner: string, name: string, input: { message: string; tree: string; parents: string[] }): Promise<string> {
			const commit = await call<{ sha: string }>("POST", `/repos/${owner}/${name}/git/commits`, {
				...input,
				author: { name: "T3Learn Backup", email: "backup@users.noreply.github.com", date: new Date().toISOString() },
			});
			return commit!.sha;
		},
		/** Fast-forward the branch (create it when the repository is empty). Never force. */
		async setHead(owner: string, name: string, branch: string, sha: string, create: boolean): Promise<void> {
			if (create) await call("POST", `/repos/${owner}/${name}/git/refs`, { ref: `refs/heads/${branch}`, sha });
			else await call("PATCH", `/repos/${owner}/${name}/git/refs/heads/${encodeURIComponent(branch)}`, { sha, force: false });
		},
	};
}

export type GitHubClient = ReturnType<typeof createGitHubClient>;

// ─── The OAuth device flow (no secret; the user confirms a code on github.com) ─

export interface DeviceCode {
	deviceCode: string;
	userCode: string;
	verificationUri: string;
	/** Seconds until the code dies. */
	expiresIn: number;
	/** Minimum seconds between polls. */
	interval: number;
}

export type DevicePoll =
	| { kind: "token"; token: string }
	| { kind: "pending" }
	| { kind: "slow_down"; interval: number }
	| { kind: "failed"; reason: string };

export interface DeviceFlowOptions {
	clientId: string;
	fetch?: typeof fetch;
	/** github.com */
	webBase?: string;
}

async function postForm<T>(doFetch: typeof fetch, url: string, body: Record<string, string>): Promise<T> {
	const res = await doFetch(url, {
		method: "POST",
		headers: { accept: "application/json", "content-type": "application/json", "user-agent": USER_AGENT },
		body: JSON.stringify(body),
	});
	const text = await res.text();
	if (!res.ok) throw new GitHubError(res.status, `GitHub ${url}: ${res.status} ${text}`.trim());
	return JSON.parse(text) as T;
}

/** Step 1: ask GitHub for a code the user types at verification_uri. */
export async function startDeviceFlow({ clientId, fetch: doFetch = fetch, webBase = "https://github.com" }: DeviceFlowOptions): Promise<DeviceCode> {
	const data = await postForm<{ device_code: string; user_code: string; verification_uri: string; expires_in: number; interval: number }>(doFetch, `${webBase}/login/device/code`, {
		client_id: clientId,
		scope: "repo",
	});
	if (!data.device_code || !data.user_code) throw new GitHubError(500, "GitHub device flow answered without a code");
	return {
		deviceCode: data.device_code,
		userCode: data.user_code,
		verificationUri: data.verification_uri || "https://github.com/login/device",
		expiresIn: Number(data.expires_in) || 900,
		interval: Number(data.interval) || 5,
	};
}

/** Step 2: poll until the user has confirmed (or the code died). */
export async function pollDeviceFlow({ clientId, fetch: doFetch = fetch, webBase = "https://github.com" }: DeviceFlowOptions, deviceCode: string): Promise<DevicePoll> {
	const data = await postForm<{ access_token?: string; error?: string; interval?: number; error_description?: string }>(doFetch, `${webBase}/login/oauth/access_token`, {
		client_id: clientId,
		device_code: deviceCode,
		grant_type: "urn:ietf:params:oauth:grant-type:device_code",
	});
	if (data.access_token) return { kind: "token", token: data.access_token };
	switch (data.error) {
		case "authorization_pending":
			return { kind: "pending" };
		case "slow_down":
			return { kind: "slow_down", interval: Number(data.interval) || 10 };
		case "expired_token":
			return { kind: "failed", reason: "The sign-in code expired. Start again." };
		case "access_denied":
			return { kind: "failed", reason: "GitHub sign-in was cancelled." };
		default:
			return { kind: "failed", reason: data.error_description || data.error || "GitHub sign-in failed." };
	}
}
