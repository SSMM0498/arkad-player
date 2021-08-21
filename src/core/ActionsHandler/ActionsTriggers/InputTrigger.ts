import { _NFMHandler } from "../../PlayerDOM/NFMHandler";
import { inputData } from "../../PlayerDOM/types";
import { warnNodeNotFound } from "../../Player/utils";

export function perform(d: inputData) {
    const target = _NFMHandler.getNode(d.id);
    if (!target) {
        return warnNodeNotFound(d, d.id);
    }
    try {
        ((target as Node) as HTMLInputElement).checked = d.isChecked;
        ((target as Node) as HTMLInputElement).value = d.text;
    } catch (error) {
        // for safe
    }
}
