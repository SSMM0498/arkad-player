import { inputData } from "../../../recorder/src/Recorder/types";
import { mirror } from "../../../recorder/src/Recorder/utils";
import { warnNodeNotFound } from "../Player/utils";

class InputPerformer {
    private data: inputData;

    constructor(d: inputData) {
        this.data = d
    }

    run() {
        const target = mirror.getNode(this.data.id);
        if (!target) {
            return warnNodeNotFound(this.data, this.data.id);
        }
        try {
            ((target as Node) as HTMLInputElement).checked = this.data.isChecked;
            ((target as Node) as HTMLInputElement).value = this.data.text;
        } catch (error) {
            // for safe
        }
    }
}

export default InputPerformer