import { Home } from "./screens/Home";
import { Host } from "./screens/Host";
import { Player } from "./screens/Player";
import { Remote } from "./screens/Remote";
import { usePath } from "./router";

export function App() {
  const path = usePath();
  if (path.startsWith("/host")) return <Host />;
  if (path.startsWith("/play")) return <Player />;
  if (path.startsWith("/remote")) return <Remote />;
  return <Home />;
}
