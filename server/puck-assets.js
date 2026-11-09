import { readFileSync } from "node:fs";

// Puck's optional Inter import is replaced by the application's bundled Inter font.
export const puckAssets = {
  name: "local-puck-font",
  setup(build) {
    build.onLoad(
      { filter: /@puckeditor\/core\/dist\/.*\.(?:mjs|js|css)$/ },
      ({ path }) => ({
        contents: readFileSync(path, "utf8").replaceAll(
          '@import "https://rsms.me/inter/inter.css";',
          "",
        ),
        loader: path.endsWith(".css") ? "css" : "js",
      }),
    );
  },
};
