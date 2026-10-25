// Personal builds are separate apps and never consume the upstream update feed.
module.exports = {
	extends: "./electron-builder.yml",
	appId: "local.learnharness.cli",
	productName: "T3Learn",
	directories: { output: "dist/local" },
	extraMetadata: { name: "learnharness-local", productName: "T3Learn", lhLocalBuild: true },
	publish: null,
	mac: { icon: "build/icon.icns", identity: null, notarize: false },
};
