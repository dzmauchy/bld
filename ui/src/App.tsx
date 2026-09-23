import { LibraryList } from "./libraries/libraryList.js";
import { Workspace } from "./view/Workspace.js";

export function App() {
  const libraries = new LibraryList().load();
  return <Workspace libraries={libraries} />;
}
