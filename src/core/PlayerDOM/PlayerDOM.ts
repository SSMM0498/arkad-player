import { Cursor, viewportResizeDimention } from "./types";
import NodeBuilder from "./NodeBuilder";

class PlayerDOM {
    public wrapper: HTMLDivElement;
    // public NodeBuilder!: NodeBuilder;
    public iframe!: HTMLIFrameElement;
    public cursor!: HTMLDivElement;
    public currentCursor!: Cursor;

    constructor(w: HTMLDivElement) {
        this.wrapper = w;
        this.handleResize = this.handleResize.bind(this);
    }

    public setupDom() {
        //  Set up wrapper
        this.wrapper.classList.add("replayer-wrapper");

        //  Set up virtual mouse
        this.cursor = document.createElement("div");
        this.cursor.classList.add("replayer-mouse");
        const cursorLight = document.createElement("div");
        cursorLight.classList.add("replayer-mouse-light");
        this.cursor.appendChild(cursorLight);
        this.wrapper.appendChild(this.cursor);

        //  Set up player iframe
        this.iframe = document.createElement("iframe");
        this.iframe.classList.add("replayer-iframe");
        this.iframe.setAttribute('sandbox', 'allow-same-origin allow-scripts');
        this.wrapper.appendChild(this.iframe);

        //  Create a Node Builder
        // this.NodeBuilder = new NodeBuilder(this.iframe)
    }

    public handleResize(dimension: viewportResizeDimention) {
        this.iframe.width = `${dimension.width}px`;
        this.iframe.height = `${dimension.height}px`;
    }
}

export default PlayerDOM;