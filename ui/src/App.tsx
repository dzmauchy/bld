import { type Library } from "core";
import { createEffect, createSignal, Show } from "solid-js";
import { LibraryList } from "./libraries/libraryList.js";
import { Workspace } from "./view/Workspace.js";

export function App(props: { onShown?: () => void }) {
  const [libraries, setLibraries] = createSignal<readonly Library[] | undefined>();
  const [failure, setFailure] = createSignal<string | undefined>();
  void new LibraryList().load().then(setLibraries).catch((error: unknown) => {
    setFailure(error instanceof Error ? error.message : String(error));
  });
  createEffect(
    () => libraries() ?? failure(),
    (ready) => {
      if (!ready) return;
      requestAnimationFrame(() => props.onShown?.());
    },
  );
  return (
    <Show
      when={libraries()}
      fallback={<p data-library-status={failure() ? "error" : "loading"}>{failure() ?? "Loading libraries"}</p>}
    >
      {(loaded) => <Workspace libraries={loaded()} />}
    </Show>
  );
}
