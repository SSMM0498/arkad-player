import { _NFMHandler } from "../../PlayerDOM/NFMHandler";
import PlayerDOM from "../../PlayerDOM/PlayerDOM";
import { DocumentDimension, incrementalData } from "../../PlayerDOM/types";
import { warnNodeNotFound } from "../../Player/utils";

export function perform(d: incrementalData, x: number, y: number, id: number, dom: PlayerDOM) {
    const target = _NFMHandler.getNode(id);
    if (!target) {
        return warnNodeNotFound(d, id);
    }

    const base = getBaseDimension(target, dom.iframe);
    // console.log(base);
    const _x = x * base.absoluteScale + base.x;
    const _y = y * base.absoluteScale + base.y;

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

export function getBaseDimension(
    node: Node,
    rootIframe: Node,
): DocumentDimension {
    const frameElement = node.ownerDocument?.defaultView?.frameElement;
    // console.log(frameElement);
    
    if (!frameElement || frameElement === rootIframe) {
        return {
            x: 0,
            y: 0,
            relativeScale: 1,
            absoluteScale: 1,
        };
    }

    const frameDimension = frameElement.getBoundingClientRect();
    const frameBaseDimension = getBaseDimension(frameElement, rootIframe);
    // the iframe element may have a scale transform
    const relativeScale = frameDimension.height / frameElement.clientHeight;
    return {
        x:
            frameDimension.x * frameBaseDimension.relativeScale +
            frameBaseDimension.x,
        y:
            frameDimension.y * frameBaseDimension.relativeScale +
            frameBaseDimension.y,
        relativeScale,
        absoluteScale: frameBaseDimension.absoluteScale * relativeScale,
    };
}