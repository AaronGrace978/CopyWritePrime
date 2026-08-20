import { Extension } from "@tiptap/core";
import { Plugin, TextSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { sentenceRangeAt } from "../lib/prose";

function selectSentence(view: EditorView, pos: number) {
  const range = sentenceRangeAt(view.state.doc, pos);
  if (!range || range.to <= range.from) return false;
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, range.from, range.to)).scrollIntoView());
  return true;
}

export const SentenceSelect = Extension.create({
  name: "sentenceSelect",
  priority: 1000,
  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          handleTripleClick(view, pos) {
            return selectSentence(view, pos);
          },
          handleClick(view, pos, event) {
            if (!event.altKey) return false;
            return selectSentence(view, pos);
          },
        },
      }),
    ];
  },
});
