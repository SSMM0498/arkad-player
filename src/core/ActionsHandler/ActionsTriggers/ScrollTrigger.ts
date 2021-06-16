import { _NFMHandler } from "../../PlayerDOM/NFMHandler";
import PlayerDOM from "../../PlayerDOM/PlayerDOM";
import { scrollData } from "../../PlayerDOM/types";
import { warnNodeNotFound } from "../../utils";

export function perform(d: scrollData, dom: PlayerDOM) {
    const target = _NFMHandler.getNode(d.id);
    if (!target) {
        return warnNodeNotFound(d, d.id);
    }
    if ((target as Node) === dom.iframe.contentDocument) {
        dom.iframe.contentWindow!.scrollTo({
            top: d.y,
            left: d.x,
            behavior: 'smooth',
        });
    } else {
        try {
            ((target as Node) as Element).scrollTop = d.y;
            ((target as Node) as Element).scrollLeft = d.x;
        } catch (error) {
            /**
             * Seldomly we may found scroll target was removed before
             * its last scroll event.
             */
        }
    }
}