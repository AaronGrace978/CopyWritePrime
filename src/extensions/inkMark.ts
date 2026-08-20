import { Mark, mergeAttributes } from "@tiptap/core";

export type InkKind = "ai" | "user";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    inkMark: {
      setInkMark: (kind: InkKind) => ReturnType;
      unsetInkMark: () => ReturnType;
      toggleUserHighlight: () => ReturnType;
      clearAiMarks: () => ReturnType;
    };
  }
}

export const InkMark = Mark.create({
  name: "inkMark",
  inclusive: false,
  excludes: "inkMark",
  addAttributes() {
    return {
      kind: {
        default: "user" as InkKind,
        parseHTML: (element) =>
          (element.getAttribute("data-kind") as InkKind | null) ||
          (element.hasAttribute("data-ai") ? "ai" : "user"),
        renderHTML: (attributes) => ({ "data-kind": attributes.kind }),
      },
    };
  },
  parseHTML() {
    return [{ tag: "mark" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["mark", mergeAttributes({ class: "ink-mark" }, HTMLAttributes), 0];
  },
  addCommands() {
    return {
      setInkMark:
        (kind) =>
        ({ commands }) =>
          commands.setMark(this.name, { kind }),
      unsetInkMark:
        () =>
        ({ commands }) =>
          commands.unsetMark(this.name),
      toggleUserHighlight:
        () =>
        ({ commands, editor }) => {
          if (editor.isActive(this.name, { kind: "user" })) return commands.unsetMark(this.name);
          return commands.setMark(this.name, { kind: "user" });
        },
      clearAiMarks:
        () =>
        ({ tr, state, dispatch }) => {
          const type = state.schema.marks.inkMark;
          if (!type) return false;
          state.doc.descendants((node, pos) => {
            if (!node.isText) return;
            const mark = node.marks.find((m) => m.type === type && m.attrs.kind === "ai");
            if (mark) tr.removeMark(pos, pos + node.nodeSize, mark);
          });
          dispatch?.(tr);
          return true;
        },
    };
  },
});
