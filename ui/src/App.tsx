import { type Library } from "core";
import { createSignal, Show } from "solid-js";
import { LibraryList } from "./libraries/libraryList.js";
import { Workspace } from "./view/Workspace.js";

export function App() {
  const [libraries, setLibraries] = createSignal<readonly Library[] | undefined>();
  const [failure, setFailure] = createSignal<string | undefined>();
  void new LibraryList().load().then(setLibraries).catch((error: unknown) => {
    setFailure(error instanceof Error ? error.message : String(error));
  });
  return (
    <Show
      when={libraries()}
      fallback={<p data-library-status={failure() ? "error" : "loading"}>{failure() ?? "Loading libraries"}</p>}
    >
      {(loaded) => <Workspace libraries={loaded()} />}
    </Show>
  );
}
