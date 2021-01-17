import { viewportResizeDimention } from "./types";

class PlayerDOM {
    public wrapper: HTMLDivElement;
    public iframe!: HTMLIFrameElement;
    public mouse!: HTMLDivElement;

    constructor(w: HTMLDivElement) {
        this.wrapper = w
    }

    public setupDom() {
        //  Set up wrapper
        this.wrapper.classList.add("replayer-wrapper");

        //  Set up virtual mouse
        this.mouse = document.createElement("div");
        this.mouse.classList.add("replayer-mouse");
        this.wrapper.appendChild(this.mouse);

        //  Set up player iframe
        this.iframe = document.createElement("iframe");
        this.iframe.setAttribute('sandbox', 'allow-same-origin');
        this.wrapper.appendChild(this.iframe);
    }

    public handleResize(dimension: viewportResizeDimention) {
        this.iframe.width = `${dimension.width}px`;
        this.iframe.height = `${dimension.height}px`;
    }
}

export default PlayerDOM