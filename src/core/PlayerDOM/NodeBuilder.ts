import {
    NodeEncoded,
    NodeType,
    DocumentNodesMap,
    NodeCaptured,
    ElementNode,
} from './types'
import { parse } from './utils'

/**
 * Class for rebuild a DOM from a encoded node
 */
class NodeBuilder {
    private readonly svgTagToCamel: { [key: string]: string } = {
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

    /**
     * change all hover rule in cssText to a class named .:hover
     * @param cssText a css text
    **/
    private changeHoverStyle(cssText: string): string {
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
        });

        return cssText
    }

    /**
     * return the real tag name 
     ** retrieve camel case form for svg tag name
     ** change link tag to style tag
     * @param n a node element
    **/
    private getTagName(n: ElementNode): string {
        let tagName = this.svgTagToCamel[n.elementName] ? this.svgTagToCamel[n.elementName] : n.elementName
        if (tagName === 'link' && n.attributes.cssText) {
            tagName = 'style'
        }
        return tagName
    }

    /**
     * rebuild iframe DOM
     ** browse each of the nodes, build it the iframe
     * @param childNodes all nodes of the iframe
     * @param map the map of those nodes
    **/
    private buildIframe(
        childNodes: NodeCaptured[],
        map: DocumentNodesMap,
    ) {
        const targetDoc = this.iframeElement.contentDocument!;
        for (const childN of childNodes) {
            this.buildAllNodes(childN, map, targetDoc);
        }
    }

    /**
     * rebuild a node from captured node
     ** in case the node is an element create it and add each of those attributes
     ** if the node is a text, create it while changing, for css rules the hover selector
     * @param currentNode the current node to build
     * @param doc the container for that node
    **/
    public buildNode(
        currentNode: NodeCaptured,
        doc: Document
    ): Node | null {
        switch (currentNode.type) {
            case NodeType.Document:
                return doc.implementation.createDocument(null, '', null);
            case NodeType.DocumentType:
                return doc.implementation.createDocumentType(
                    currentNode.name || 'html',
                    currentNode.publicId,
                    currentNode.systemId,
                );
            case NodeType.Element:
                let tagName = this.getTagName(currentNode);
                let node: Element;

                node = doc.createElement(tagName);

                for (const name in currentNode.attributes) {
                    // attribute names start with _ are internal attributes added by the core
                    if (currentNode.attributes.hasOwnProperty(name) && !name.startsWith('_')) {
                        let value = currentNode.attributes[name];
                        value = typeof value === 'boolean' ? '' : value;
                        const isTextarea = tagName === 'textarea' && name === 'value';
                        const isExternalOrInternalCss = tagName === 'style' && name === 'cssText';
                        if (isExternalOrInternalCss) {
                            value = this.changeHoverStyle(value as string);
                        }
                        if (isTextarea || isExternalOrInternalCss) {
                            const child = doc.createTextNode(value as string);
                            node.setAttribute('styleSheet', 'text/css');
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
                let textContent = currentNode.textContent
                if (currentNode.isCSSRules) { textContent = this.changeHoverStyle(currentNode.textContent) }
                return doc.createTextNode(textContent);
            default:
                return null;
        }
    }

    /**
     * rebuild all nodes of a tree from the root node
     ** build the root node
     ** build recursively the child nodes of that node
     * @param rootNode root node
     * @param map node as a map
     * @param doc the document root
    **/
    public buildAllNodes(
        rootNode: NodeCaptured,
        map: DocumentNodesMap,
        doc: Document
    ): [NodeEncoded | null, NodeCaptured[]] {
        let node = this.buildNode(rootNode, doc);
        
        if (!node) {
            return [null, [rootNode]]; // TODO: Check this
        }
        // TODO: Check this
        if (rootNode.originId) {
            console.assert(
                ((map[rootNode.originId] as unknown) as Document) === doc,
                'Target document should has the same root id',
            );
        }

        
        // Use target document as root document
        (node as NodeEncoded)._cnode = rootNode;
        map[rootNode.nodeId] = node as NodeEncoded;

        if (
            rootNode.type === NodeType.Document || 
            rootNode.type === NodeType.Element
        ) {
            const nodeIsIframe = isIframe(rootNode);

            if (nodeIsIframe) {
                return [node as NodeEncoded, rootNode.childNodes];
            }
            for (const childN of rootNode.childNodes) {
                const [childNode, nestedNodes] = this.buildAllNodes(childN, map, doc);

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
        return [node as NodeEncoded, []];
    }

    /**
     * launch a build process
     * @param n root node
     * @param doc the document
     */
    public build(
        n: NodeCaptured,
        doc: Document
    ): [Node | null, DocumentNodesMap] {
        const DocumentNodesMap: DocumentNodesMap = {}
        const [node] = this.buildAllNodes(n, DocumentNodesMap, doc);
        return [node, DocumentNodesMap]
    }
}

/**
 * check if this node is an iframe
 * @param n a captured node
 */
function isIframe(n: NodeCaptured) {
    return n.type === NodeType.Element && n.elementName === 'iframe';
}

export default NodeBuilder;
