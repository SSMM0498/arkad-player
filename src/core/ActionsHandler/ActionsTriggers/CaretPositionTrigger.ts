import { warnNodeNotFound } from "../../Player/utils";
import { _NFMHandler } from "../../PlayerDOM/NFMHandler";
import PlayerDOM from "../../PlayerDOM/PlayerDOM";
import { caretPositionData } from "../../PlayerDOM/types";

export function perform(d: caretPositionData, dom: PlayerDOM) {
    const focusNode = ((_NFMHandler.getNode(d.caretInfos.focusId) as Node) as HTMLElement);
    if (focusNode) {
        focusNode.focus();
        setTimeout(function () {
            (focusNode as HTMLInputElement).selectionStart = d.caretInfos.offset;
            (focusNode as HTMLInputElement).selectionEnd = d.caretInfos.offset;
        }, 0);
    } else return warnNodeNotFound(d, d.caretInfos.focusId);
}