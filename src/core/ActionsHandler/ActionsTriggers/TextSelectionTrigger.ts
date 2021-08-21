import { warnNodeNotFound } from "../../Player/utils";
import { _NFMHandler } from "../../PlayerDOM/NFMHandler";
import PlayerDOM from "../../PlayerDOM/PlayerDOM";
import { textSelectionData } from "../../PlayerDOM/types";

export function perform(d: textSelectionData, dom: PlayerDOM) {
    const anchorNode = _NFMHandler.getNode(d.selection.anchorId);
    const focusNode = _NFMHandler.getNode(d.selection.focusId);

    if (!anchorNode) { return warnNodeNotFound(d, d.selection.anchorId); }
    if (!focusNode) { return warnNodeNotFound(d, d.selection.focusId); }

    try {
        if (!dom.iframe.contentDocument) {
            return console.warn('Looks like your replayer has been destroyed.');
        }
        const sel = dom.iframe.contentDocument.getSelection();
        // Why wee need to substract nine to have the good selection
        if (sel) { 
            sel.setBaseAndExtent(
                anchorNode,
                d.selection.anchorOffset,
                focusNode,
                d.selection.focusOffset - 9
            );
        }
    } catch (error) {
        // for safe
    }
}