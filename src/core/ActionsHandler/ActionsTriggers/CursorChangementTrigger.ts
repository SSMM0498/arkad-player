import PlayerDOM from "../../PlayerDOM/PlayerDOM";
import { Cursor, cursorChangementData } from "../../PlayerDOM/types";

export function perform(d: cursorChangementData, dom: PlayerDOM) {
    resetCursor(dom);
    dom.currentCursor = d.type;
    console.log(dom.currentCursor);
    switch (d.type) {
        case Cursor.Alias:
        case Cursor.AllScroll:
        case Cursor.Cell:
        case Cursor.ColResize:
        case Cursor.ContextMenu:
        case Cursor.Copy:
        case Cursor.Crosshair:
        case Cursor.Grab:
        case Cursor.Grabbing:
        case Cursor.Help:
        case Cursor.Move:
        case Cursor.NoDrop:
        case Cursor.None:
        case Cursor.NotAllowed:
        case Cursor.Pointer:
        case Cursor.Progress:
        case Cursor.RowResize:
        case Cursor.Text:
        case Cursor.VerticalText:
        case Cursor.Wait:
        case Cursor.ZoomIn:
        case Cursor.ZoomOut:
        case Cursor.EWResize:
        case Cursor.NESWResize:
        case Cursor.NWSEResize:
        case Cursor.NResize:
        case Cursor.EResize:
        case Cursor.SResize:
        case Cursor.WResize:
        case Cursor.NEResize:
        case Cursor.NWResize:
        case Cursor.NSResize:
        case Cursor.SEResize:
        case Cursor.SWResize:
            const type = Cursor[getKeyName(Cursor, dom.currentCursor)!];
            void dom.cursor.offsetWidth;
            dom.cursor.classList.add(type);
            break;
        case Cursor.Default:
            break;
        default:
            console.log("Unknow Cursor");
            break;
    }
}

function getKeyName<T extends Record<string, string>>(_enum: T, value: string): keyof T | undefined {
    return Object.entries(_enum).find(([key, val]) => val === value)?.[0];
}

function resetCursor(dom: PlayerDOM) {
    const type = Cursor[getKeyName(Cursor, dom.currentCursor)!];
    dom.cursor.classList.remove(type);
}
