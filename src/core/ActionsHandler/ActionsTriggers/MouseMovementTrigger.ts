import { _NFMHandler } from "../../PlayerDOM/NFMHandler";
import PlayerDOM from "../../PlayerDOM/PlayerDOM";
import { incrementalData } from "../../PlayerDOM/types";
import { warnNodeNotFound } from "../../utils";

export function perform(d: incrementalData, x: number, y: number, id: number, dom: PlayerDOM) {
    dom.cursor.style.left = `${x}px`;
    dom.cursor.style.top = `${y}px`;

    const target = _NFMHandler.getNode(id);
    if (!target) {
        return warnNodeNotFound(d, id);
    }
    hoverElements((target as Node) as Element, dom);
}

function hoverElements(el: Element, dom: PlayerDOM) {
    dom.iframe
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