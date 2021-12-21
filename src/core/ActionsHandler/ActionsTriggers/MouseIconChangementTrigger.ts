import PlayerDOM from "../../PlayerDOM/PlayerDOM";
import { MouseIcon, mouseIconChangementData } from "../../PlayerDOM/types";

export function perform(d: mouseIconChangementData, dom: PlayerDOM) {
    switch (d.type) {
        case MouseIcon.Grabbing:
            dom.cursor.classList.remove('grab');
            void dom.cursor.offsetWidth;
            dom.cursor.classList.add('grab');
            break;
        default:
            dom.cursor.classList.remove('grab');
            break;
    }
}