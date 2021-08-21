import { _NFMHandler } from "../../PlayerDOM/NFMHandler";
import PlayerDOM from "../../PlayerDOM/PlayerDOM";
import { DocumentDimension, incrementalData } from "../../PlayerDOM/types";
import { warnNodeNotFound } from "../../Player/utils";

export function perform(d: incrementalData, x: number, y: number, id: number, dom: PlayerDOM) {

    const target = _NFMHandler.getNode(id);
    if (!target) {
        return warnNodeNotFound(d, id);
    }

    const base = getBaseDimension(target);
    const _x = x + base.x - 6;
    const _y = y + base.y - 4;

    dom.cursor.style.left = `${_x}px`;
    dom.cursor.style.top = `${_y}px`;

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

export function getBaseDimension(node: Node): DocumentDimension {
    const frameElement = node.ownerDocument?.defaultView?.frameElement;
    if (!frameElement) {
        return {
            x: 0,
            y: 0,
        };
    }

    const frameDimension = frameElement.getBoundingClientRect();
    const frameBaseDimension = getBaseDimension(frameElement);
    return {
        x: frameDimension.x + frameBaseDimension.x,
        y: frameDimension.y + frameBaseDimension.y,
    };
}