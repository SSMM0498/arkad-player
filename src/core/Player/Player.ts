import NodeBuilder from "../PlayerDOM/NodeBuilder";
import PlayerDOM from "../PlayerDOM/PlayerDOM";
import { _NFMHandler } from "../PlayerDOM/NFMHandler";
import { Emitter, EventType, eventWithTime, fullCaptureEvent, metaEvent, ReplayerEvents } from "../PlayerDOM/types";
import * as mittProxy from 'mitt';

const mitt = (mittProxy as any).default || mittProxy;

export default class Player {
    public dom!: PlayerDOM;

    private events: eventWithTime[] = [];

    private NodeBuilder!: NodeBuilder;

    private emitter: Emitter = mitt();

    constructor(
        events: eventWithTime[],
        w: HTMLDivElement
    ) {
        // retrieve the recorded events to replay
        this.events = events;

        // initialize the main classes
        this.initUtils(w);

        // rebuild first full snapshot as the poster of the player
        // maybe we can cache it for performance optimization
        this.setPlayerPoster();

        console.log("initialisation end");
    }

    private setPlayerPoster() {
        // first meta information
        const firstMeta = this.events.find((e) => e.type === EventType.Meta);
        if (firstMeta) {
            const { width, height } = firstMeta.data as metaEvent['data'];
            this.emitter.emit(ReplayerEvents.Resize, {
                width,
                height,
            });
        }

        // first full capture
        const firstFullCapture = this.events.find((e) => e.type === EventType.FullCapture);
        if (firstFullCapture) {
            this.rebuildFullCapture(
                firstFullCapture as fullCaptureEvent & { timestamp: number },
            );
        }
    }

    private initUtils(w: HTMLDivElement) {
        // Setup the player dom (wrapper, iframe, fake cursor mouse)
        this.dom = new PlayerDOM(w);
        this.dom.setupDom();

        // Create a Node builder
        this.NodeBuilder = new NodeBuilder(this.dom.iframe);
    }

    private rebuildFullCapture(event: fullCaptureEvent, isSync: boolean = false) {
        if (!this.dom.iframe.contentDocument) {
            return console.warn("Looks like your replayer has been destroyed.");
        }

        const _buildResult = this.NodeBuilder.build(event.data.node, this.dom.iframe.contentDocument);

        const _dom = _buildResult[0];
        _NFMHandler.map = _buildResult[1];

        const domJson = (_dom as HTMLDocument)!.documentElement.outerHTML;

        this.dom.iframe.contentWindow!.document.open('text/html', 'replace');
        this.dom.iframe.contentWindow!.document.write(domJson);
        this.dom.iframe.contentWindow!.document.close();
        
        // avoid form submit to refresh the iframe
        this.dom.iframe.contentDocument!.addEventListener('submit', evt => {
            if (evt.target && (evt.target as Element).tagName === 'FORM') {
                evt.preventDefault();
            }
        });
        // avoid a link click to refresh the iframe
        this.dom.iframe.contentDocument!.addEventListener('click', evt => {
            if (evt.target && (evt.target as Element).tagName === 'A') {
                evt.preventDefault();
            }
        })
    }
}