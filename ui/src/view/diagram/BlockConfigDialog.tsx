import "@awesome.me/webawesome/dist/components/dialog/dialog.js";
import type { DiagramBlock } from "core";
import { For } from "solid-js";
import {
  BlockConfigField,
  BlockConfiguration,
  NumberConfigControl,
  type ConfigControl,
  type NumericBounds,
} from "./blockConfiguration.js";

/** Dialog that edits every configuration parameter of one block. */
export function BlockConfigDialog(props: {
  block: DiagramBlock;
  revision: number;
  onCommit: () => void;
  onClose: () => void;
}) {
  const configuration = () => BlockConfiguration.of(props.block);
  return (
    <wa-dialog
      class="block-config-dialog"
      data-block-config-dialog
      data-block-id={props.block.id}
      label={props.block.definition.title}
      ref={(element) => attachDialog(element, props.onClose)}
    >
      <form class="block-config-form" onSubmit={(event) => event.preventDefault()}>
        <For each={configuration()?.fields ?? []} keyed={(field) => field.id}>
          {(field) => <ConfigField field={field()} revision={props.revision} onCommit={props.onCommit} />}
        </For>
      </form>
    </wa-dialog>
  );
}

function attachDialog(element: HTMLElement, onClose: () => void): void {
  const dialog = element as HTMLElement & { open: boolean; lightDismiss: boolean };
  dialog.lightDismiss = true;
  dialog.open = true;
  dialog.addEventListener("wa-hide", (event) => {
    if (event.target !== dialog) return;
    onClose();
  });
}

function ConfigField(props: { field: BlockConfigField; revision: number; onCommit: () => void }) {
  const text = () => {
    props.revision;
    return props.field.text;
  };
  const commit = (value: string) => {
    if (props.field.commit(value)) props.onCommit();
  };
  return (
    <label class="block-config-field" data-config-field={props.field.id}>
      <span class="block-config-label">{props.field.label}</span>
      <FieldInput control={props.field.control} text={text()} onCommit={commit} />
      <span class="block-config-hint">{props.field.description}</span>
    </label>
  );
}

function FieldInput(props: { control: ConfigControl; text: string; onCommit: (value: string) => void }) {
  const bounds = boundsOf(props.control);
  if (props.control.kind === "slider") {
    return (
      <input
        type="range"
        min={bounds?.min}
        max={bounds?.max}
        step={bounds?.step}
        value={props.text}
        onInput={(event) => props.onCommit(event.currentTarget.value)}
      />
    );
  }
  if (props.control.kind === "text") {
    return <input type="text" value={props.text} onChange={(event) => props.onCommit(event.currentTarget.value)} />;
  }
  return (
    <input
      type="number"
      min={bounds?.min}
      max={bounds?.max}
      step={bounds?.step ?? "any"}
      value={props.text}
      onChange={(event) => props.onCommit(event.currentTarget.value)}
    />
  );
}

function boundsOf(control: ConfigControl): NumericBounds | undefined {
  return control instanceof NumberConfigControl ? control.bounds : undefined;
}
