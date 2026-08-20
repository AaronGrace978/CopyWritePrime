import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

export interface FlowGhostStorage {
  text: string;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    flowGhost: {
      setFlowGhost: (text: string) => ReturnType;
      acceptFlowGhost: () => ReturnType;
      clearFlowGhost: () => ReturnType;
    };
  }
}

const key = new PluginKey<FlowGhostStorage>("flowGhost");

export const FlowGhost = Extension.create({
  name: "flowGhost",
  addCommands() {
    return {
      setFlowGhost:
        (text: string) =>
        ({ tr, dispatch }) => {
          tr.setMeta(key, { text });
          dispatch?.(tr);
          return true;
        },
      clearFlowGhost:
        () =>
        ({ tr, dispatch }) => {
          tr.setMeta(key, { text: "" });
          dispatch?.(tr);
          return true;
        },
      acceptFlowGhost:
        () =>
        ({ state, dispatch, tr }) => {
          const ghost = key.getState(state)?.text ?? "";
          if (!ghost) return false;
          if (dispatch) {
            const from = state.selection.from;
            tr.insertText(ghost, from);
            const mark = state.schema.marks.inkMark;
            if (mark) tr.addMark(from, from + ghost.length, mark.create({ kind: "ai" }));
            tr.setMeta(key, { text: "" });
            dispatch(tr);
          }
          return true;
        },
    };
  },
  addKeyboardShortcuts() {
    return {
      Tab: () => this.editor.commands.acceptFlowGhost(),
      Escape: () => this.editor.commands.clearFlowGhost(),
    };
  },
  addProseMirrorPlugins() {
    return [
      new Plugin<FlowGhostStorage>({
        key,
        state: {
          init: () => ({ text: "" }),
          apply(tr, value) {
            const meta = tr.getMeta(key) as FlowGhostStorage | undefined;
            if (meta) return meta;
            if (tr.docChanged) return { text: "" };
            return value;
          },
        },
        props: {
          decorations(state) {
            const ghost = key.getState(state)?.text;
            if (!ghost) return DecorationSet.empty;
            const pos = state.selection.from;
            const widget = Decoration.widget(
              pos,
              () => {
                const span = document.createElement("span");
                span.className = "flow-ghost";
                span.textContent = ghost;
                return span;
              },
              { side: 1 },
            );
            return DecorationSet.create(state.doc, [widget]);
          },
        },
      }),
    ];
  },
});
