// Personal builds are separate apps and never consume the upstream update feed.
module.exports = {
	extends: "./electron-builder.yml",
	appId: "local.learnharness.cli",
	productName: "LearnHarness Local",
	directories: { output: "dist/local" },
	extraMetadata: { name: "learnharness-local", productName: "LearnHarness Local", lhLocalBuild: true },
	publish: null,
	mac: { icon: "build/icon.icns", identity: null, notarize: false },
};
