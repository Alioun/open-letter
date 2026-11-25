// Preload for HTTP tests of the meeting routes: the example letter with its
// Zoom meeting switched on.
import letter from "../../config/letters/example/index.js";
if (process.env.HTTP_FIXTURE_ZOOM !== "1")
  throw new Error("Only for the HTTP test fixture");
letter.features = { ...letter.features, zoomEvent: true };
