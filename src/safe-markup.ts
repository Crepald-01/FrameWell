const htmlTags = new Set('div span p h1 h2 h3 h4 h5 h6 strong b em i small br section article header footer main figure figcaption ul ol li pre code'.split(' '))
const svgTags = new Set('svg g path circle ellipse line rect polygon polyline text tspan defs linearGradient radialGradient stop clipPath'.split(' '))
const svgAttrs = new Set('viewBox preserveAspectRatio d x y x1 x2 y1 y2 cx cy r rx ry width height points fill fill-opacity fill-rule stroke stroke-width stroke-opacity stroke-linejoin stroke-linecap stroke-dasharray opacity transform text-anchor dominant-baseline font-size font-weight font-family offset stop-color stop-opacity gradientUnits gradientTransform clip-path clip-rule vector-effect'.split(' '))
const cssProperties = new Set(`
  position inset inset-inline inset-block top right bottom left width height min-width min-height max-width max-height
  display visibility opacity z-index isolation box-sizing overflow overflow-x overflow-y aspect-ratio
  margin margin-top margin-right margin-bottom margin-left padding padding-top padding-right padding-bottom padding-left
  flex flex-basis flex-grow flex-shrink flex-flow flex-direction flex-wrap align-items align-self align-content
  justify-content justify-items justify-self gap row-gap column-gap
  grid grid-template grid-template-columns grid-template-rows grid-column grid-row grid-auto-flow place-items place-content
  color background background-color background-image background-size background-position
  border border-width border-style border-color border-top border-right border-bottom border-left border-radius
  border-top-left-radius border-top-right-radius border-bottom-left-radius border-bottom-right-radius box-shadow outline outline-offset
  font font-family font-size font-weight font-style font-variant-numeric line-height letter-spacing word-spacing
  text-align text-decoration text-transform text-shadow white-space word-break overflow-wrap
  transform transform-origin translate rotate scale perspective transform-style backface-visibility
  mix-blend-mode filter clip-path fill stroke stroke-width
`.trim().split(/\s+/))
const svgNamespace = 'http://www.w3.org/2000/svg'
const localReference = /^url\(#[\w:-]+\)$/
const takesResource = /(?:url\s*\(|(?:-webkit-)?image-set\s*\(|image\s*\(|paint\s*\(|element\s*\(|attr\s*\()/i

export function safeMarkup(html: string) {
  const result = document.createDocumentFragment()
  const template = document.createElement('template')
  template.innerHTML = html
  let remaining = 5000
  function copy(source: Node, parent: Node, depth: number) {
    if (--remaining < 0 || depth > 64) return
    if (source.nodeType === Node.TEXT_NODE) {
      parent.appendChild(document.createTextNode(source.textContent || ''))
      return
    }
    if (source.nodeType !== Node.ELEMENT_NODE) return
    const from = source as HTMLElement | SVGElement
    const svg = from.namespaceURI === svgNamespace
    if (!(svg ? svgTags : htmlTags).has(from.localName)) return
    const to = svg ? document.createElementNS(svgNamespace, from.localName) : document.createElement(from.localName)
    for (const attribute of from.attributes) {
      if (attribute.name === 'id' && /^[\w:-]{1,100}$/.test(attribute.value)) to.setAttribute('id', attribute.value)
      if (svg && svgAttrs.has(attribute.name) && (!takesResource.test(attribute.value) || localReference.test(attribute.value))) {
        to.setAttribute(attribute.name, attribute.value)
      }
    }
    for (const name of from.style) {
      const value = from.style.getPropertyValue(name)
      if (cssProperties.has(name) && !takesResource.test(value)) to.style.setProperty(name, value)
    }
    parent.appendChild(to)
    for (const child of from.childNodes) {
      if (remaining <= 0) break
      copy(child, to, depth + 1)
    }
  }
  for (const child of template.content.childNodes) {
    if (remaining <= 0) break
    copy(child, result, 0)
  }
  return result
}
