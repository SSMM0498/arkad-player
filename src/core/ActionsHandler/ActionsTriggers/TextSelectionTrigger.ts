import { warnNodeNotFound } from "../../Player/utils";
import { _NFMHandler } from "../../PlayerDOM/NFMHandler";
import PlayerDOM from "../../PlayerDOM/PlayerDOM";
import { textSelectionData } from "../../PlayerDOM/types";

export function perform(d: textSelectionData, dom: PlayerDOM) {
    const focusNode = _NFMHandler.getNode(d.selection.focusId);
    if (!focusNode) { return warnNodeNotFound(d, d.selection.focusId); }

    if ("anchorId" in d.selection) {
        const anchorNode = _NFMHandler.getNode(d.selection.anchorId);
    
        if (!anchorNode) { return warnNodeNotFound(d, d.selection.anchorId); }
    
        console.log(focusNode);
    
        try {
            if (!dom.iframe.contentDocument) {
                return console.warn('Looks like your replayer has been destroyed.');
            }
            const sel = dom.iframe.contentDocument.getSelection();
            if (sel) {
                sel.setBaseAndExtent(
                    anchorNode,
                    d.selection.anchorOffset,
                    focusNode,
                    d.selection.focusOffset
                );
            }
        } catch (error) {
            // for safe
        }
    } else if ("selectionStart" in d.selection) {
        const _focusNode = ((focusNode as Node) as HTMLElement);
        _focusNode.focus();
        (_focusNode as HTMLInputElement).selectionStart = d.selection.selectionStart!;
        (_focusNode as HTMLInputElement).selectionEnd = d.selection.selectionEnd!;
    }
}