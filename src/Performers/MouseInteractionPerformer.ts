import { mouseInteractionData, MouseInteractions } from "../../../recorder/src/Recorder/types";
import { mirror } from "../../../recorder/src/Recorder/utils";
import PlayerDOM from "../Player/PlayerDOM";
import { warnNodeNotFound } from "../Player/utils";

class MouseInteractionPerformer {
    private data: mouseInteractionData;
    private isSync: boolean;
    private dom: PlayerDOM;

    constructor(d: mouseInteractionData, i: boolean, dom: PlayerDOM) {
        this.data = d
        this.isSync = i
        this.dom = dom
    }

    run() {
        const target = mirror.getNode(this.data.id);
        if (!target) {
            return warnNodeNotFound(this.data, this.data.id);
        }
        switch (this.data.type) {
            case MouseInteractions.Blur:
                if ('blur' in ((target as Node) as HTMLElement)) {
                    ((target as Node) as HTMLElement).blur();
                }
                break;
            case MouseInteractions.Focus:
                ((target as Node) as HTMLElement).focus({
                    preventScroll: true,
                });
                break;
            case MouseInteractions.Click:
            case MouseInteractions.TouchStart:
            case MouseInteractions.TouchEnd:
                /**
                 * Click has no visual impact when replaying and may
                 * trigger navigation when apply to an <a> link.
                 * So we will not call click(), instead we add an
                 * animation to the mouse element which indicate user
                 * clicked at this moment.
                 */
                if (!this.isSync) {

                    this.dom.mouse.style.left = `${this.data.x}px`;
                    this.dom.mouse.style.top = `${this.data.y}px`;

                    const target = mirror.getNode(this.data.id);
                    if (!target) {
                        return warnNodeNotFound(this.data, this.data.id);
                    }
                    this.hoverElements((target as Node) as Element);
                    this.dom.mouse.classList.remove('active');
                    // tslint:disable-next-line
                    void this.dom.mouse.offsetWidth;
                    this.dom.mouse.classList.add('active');
                }
                break;
            default:
        }
    }

    private hoverElements(el: Element) {
        this.dom.iframe
            .contentDocument!.querySelectorAll('.\\:hover')
            .forEach(hoveredEl => {
                hoveredEl.classList.remove(':hover');
            });
        let currentEl: Element | null = el;
        while (currentEl) {
            if (currentEl.classList) {
                currentEl.classList.add(':hover');
            }
            currentEl = currentEl.parentElement;
        }
    }
}

export default MouseInteractionPerformer