import {
    NodeFormated,
    NodeType,
    DocumentNodesMap,
    NodeCaptured,
    ElementNode,
} from '../../../recorder/src/NodeCaptor/types'
import { parse } from './utils'

type tagMap = {
    [key: string]: string
}

class NodeBuilder {
    private readonly elementsNameAdapter: tagMap = {
        script: 'noscript',
        // camel case svg element tag names
        altglyph: 'altGlyph',
        altglyphdef: 'altGlyphDef',
        altglyphitem: 'altGlyphItem',
        animatecolor: 'animateColor',
        animatemotion: 'animateMotion',
        animatetransform: 'animateTransform',
        clippath: 'clipPath',
        feblend: 'feBlend',
        fecolormatrix: 'feColorMatrix',
        fecomponenttransfer: 'feComponentTransfer',
        fecomposite: 'feComposite',
        feconvolvematrix: 'feConvolveMatrix',
        fediffuselighting: 'feDiffuseLighting',
        fedisplacementmap: 'feDisplacementMap',
        fedistantlight: 'feDistantLight',
        fedropshadow: 'feDropShadow',
        feflood: 'feFlood',
        fefunca: 'feFuncA',
        fefuncb: 'feFuncB',
        fefuncg: 'feFuncG',
        fefuncr: 'feFuncR',
        fegaussianblur: 'feGaussianBlur',
        feimage: 'feImage',
        femerge: 'feMerge',
        femergenode: 'feMergeNode',
        femorphology: 'feMorphology',
        feoffset: 'feOffset',
        fepointlight: 'fePointLight',
        fespecularlighting: 'feSpecularLighting',
        fespotlight: 'feSpotLight',
        fetile: 'feTile',
        feturbulence: 'feTurbulence',
        foreignobject: 'foreignObject',
        glyphref: 'glyphRef',
        lineargradient: 'linearGradient',
        radialgradient: 'radialGradient',
    }
    private readonly HOVER_SELECTOR = /([^\\]):hover/g;
    private iframeElement: HTMLIFrameElement;

    constructor(iframe: HTMLIFrameElement) {
        this.iframeElement = iframe
    }

    private adaptHoverStyle(cssText: string): string {
        const ast = parse(cssText, { silent: true })
        if (!ast.stylesheet) {
            return cssText
        }
        ast.stylesheet.rules.forEach((rule) => {
            if ('selectors' in rule) {
                ; (rule.selectors || []).forEach((selector: string) => {
                    if (this.HOVER_SELECTOR.test(selector)) {
                        const newSelector = selector.replace(
                            this.HOVER_SELECTOR,
                            '$1.\\:hover',
                        )
                        cssText = cssText.replace(
                            selector,
                            `${selector}, ${newSelector}`,
                        )
                    }
                })
            }
        })
        return cssText
    }

    private getTagName(n: ElementNode): string {
        let tagName = this.elementsNameAdapter[n.ElementName] ? this.elementsNameAdapter[n.ElementName] : n.ElementName
        if (tagName === 'link' && n.attributes._cssText) {
            tagName = 'style'
        }
        return tagName
    }

    private buildIframe(
        childNodes: NodeCaptured[],
        map: DocumentNodesMap,
    ) {
        const targetDoc = this.iframeElement.contentDocument!;
        for (const childN of childNodes) {
            this.buildNodeMap(childN, map, targetDoc);
        }
    }

    public buildNode(
        currentNode: NodeCaptured,
        doc: Document
    ): Node | null {
        switch (currentNode.type) {
            case NodeType.Element:
                const tagName = this.getTagName(currentNode);
                let node: Element;
                node = doc.createElement(tagName);

                for (const name in currentNode.attributes) {
                    // attribute names start with rr_ are internal attributes added by rrweb
                    if (currentNode.attributes.hasOwnProperty(name) && !name.startsWith('__')) {
                        let value = currentNode.attributes[name];
                        value = typeof value === 'boolean' ? '' : value;
                        const isTextarea = tagName === 'textarea' && name === 'value';
                        const isExternalOrInternalCss = tagName === 'style' && name === '_cssText';
                        if (isExternalOrInternalCss) {
                            value = this.adaptHoverStyle(value as string);
                        }
                        if (isTextarea || isExternalOrInternalCss) {
                            const child = doc.createTextNode(value as string);
                            node.appendChild(child);
                            continue;
                        }
                        if (tagName === 'iframe' && name === 'src') {
                            continue;
                        }
                        try {
                            node.setAttribute(name, value as string);
                        } catch (error) {
                            // skip invalid attribute
                        }
                    } else {
                        // handle internal attributes
                        if (currentNode.attributes.__width) {
                            (node as HTMLElement).style.width = currentNode.attributes.__width as string;
                        }
                        if (currentNode.attributes.__height) {
                            (node as HTMLElement).style.height = currentNode.attributes.__height as string;
                        }
                    }
                }

                return node;
            case NodeType.Text:
                return doc.createTextNode(
                    currentNode.isCSSRules ? this.adaptHoverStyle(currentNode.textContent) : currentNode.textContent,
                );
            default:
                return null;
        }
    }

    public buildNodeMap(
        currentNode: NodeCaptured,
        map: DocumentNodesMap,
        doc: Document
    ): [NodeFormated | null, NodeCaptured[]] {
        let node = this.buildNode(currentNode, doc);
        if (!node) {
            return [null, [currentNode]]; // TODO: Check this
        }
        //  TODO: Check this
        if (currentNode.originId) {
            console.assert(
                ((map[currentNode.originId] as unknown) as Document) === doc,
                'Target document should has the same root id',
            );
        }
        // use target document as root document

        (node as NodeFormated)._fnode = currentNode;
        map[currentNode.nodeId] = node as NodeFormated;

        if (
            currentNode.type === NodeType.Element
        ) {
            const nodeIsIframe = isIframe(currentNode);
            if (nodeIsIframe) {
                return [node as NodeFormated, currentNode.childNodes];
            }
            for (const childN of currentNode.childNodes) {
                const [childNode, nestedNodes] = this.buildNodeMap(childN, map, doc);
                if (!childNode) {
                    console.warn('Failed to rebuild', childN);
                    continue;
                }

                node.appendChild(childNode);
                if (nestedNodes.length === 0) {
                    continue;
                }

                const childNodeIsIframe = isIframe(childN);
                if (childNodeIsIframe) {
                    this.buildIframe(
                        nestedNodes,
                        map,
                    )
                }
            }
        }
        return [node as NodeFormated, []];
    }

    public build(
        n: NodeCaptured,
        doc: Document
    ): [Node | null, DocumentNodesMap] {
        const DocumentNodesMap: DocumentNodesMap = {}
        const [node] = this.buildNodeMap(n, DocumentNodesMap, doc)
        return [node, DocumentNodesMap]
    }
}

function isIframe(n: NodeCaptured) {
    return n.type === NodeType.Element && n.ElementName === 'iframe';
}

export default NodeBuilder
