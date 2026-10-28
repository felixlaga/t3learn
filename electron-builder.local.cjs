// Personal builds are separate apps and never consume the upstream update feed.
// They update from their own feed instead (owner, 2026-10-28): the rolling
// `local-latest` prerelease on the fork, written by the local-build workflow.
// electron/local-update.cjs reads the three extraMetadata fields below from
// the asar's package.json: lhLocalBuild switches the updater implementation,
// lhBuild identifies this build (CI passes the run number and commit; a hand
// build is build 0, so any CI build counts as newer), lhUpdateFeed is the
// manifest URL. LH_UPDATE_FEED at runtime overrides the feed for drills.
const repo = process.env.LH_LOCAL_UPDATE_REPO || "felixlaga/t3learn";
const build = {
	number: Number.parseInt(process.env.LH_BUILD_NUMBER ?? "0", 10) || 0,
	commit: process.env.LH_BUILD_COMMIT ?? "",
	builtAt: new Date().toISOString(),
};

module.exports = {
	extends: "./electron-builder.yml",
	appId: "local.learnharness.cli",
	productName: "T3Learn",
	directories: { output: "dist/local" },
	extraMetadata: {
		name: "learnharness-local",
		productName: "T3Learn",
		lhLocalBuild: true,
		lhBuild: build,
		lhUpdateFeed: `https://github.com/${repo}/releases/download/local-latest/local-latest.json`,
	},
	publish: null,
	mac: { icon: "build/icon.icns", identity: null, notarize: false },
	// The DMG keeps one name across versions (owner, 2026-10-28) so the
	// download link on a website never changes:
	// https://github.com/<repo>/releases/download/local-latest/T3Learn.dmg
	// The zip keeps electron-builder's versioned name; the updater reads
	// the real name from the manifest, so neither side depends on the other.
	dmg: { artifactName: "T3Learn.dmg" },
};
