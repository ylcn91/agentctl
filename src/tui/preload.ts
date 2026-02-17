import { transformAsync } from "@babel/core";
import ts from "@babel/preset-typescript";
import solid from "babel-preset-solid";
import { plugin, type BunPlugin } from "bun";

const tuiSolidPlugin: BunPlugin = {
  name: "agentctl-solid-tui",
  setup(build) {
    build.onLoad({ filter: /\/node_modules\/solid-js\/dist\/server\.js$/ }, async (args) => {
      const code = await Bun.file(args.path.replace("server.js", "solid.js")).text();
      return { contents: code, loader: "js" };
    });
    build.onLoad({ filter: /\/node_modules\/solid-js\/store\/dist\/server\.js$/ }, async (args) => {
      const code = await Bun.file(args.path.replace("server.js", "store.js")).text();
      return { contents: code, loader: "js" };
    });

    build.onLoad({ filter: /\/src\/tui\/.*\.(js|ts)x$/ }, async (args) => {
      const code = await Bun.file(args.path).text();
      const result = await transformAsync(code, {
        filename: args.path,
        presets: [
          [solid, { moduleName: "@opentui/solid", generate: "universal" }],
          [ts],
        ],
      });
      return { contents: result?.code ?? "", loader: "js" };
    });
  },
};

plugin(tuiSolidPlugin);
