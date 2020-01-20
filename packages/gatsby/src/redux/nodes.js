/* @flow */

const { store } = require(`./index`)

/**
 * Get all nodes from redux store.
 *
 * @returns {Array}
 */
const getNodes = () => {
  const nodes = store.getState().nodes
  if (nodes) {
    return Array.from(nodes.values())
  } else {
    return []
  }
}

exports.getNodes = getNodes

/** Get node by id from store.
 *
 * @param {string} id
 * @returns {Object}
 */
const getNode = id => store.getState().nodes.get(id)

exports.getNode = getNode

/**
 * Get all nodes of type from redux store.
 *
 * @param {string} type
 * @returns {Array}
 */
const getNodesByType = type => {
  const nodes = store.getState().nodesByType.get(type)
  if (nodes) {
    return Array.from(nodes.values())
  } else {
    return []
  }
}

exports.getNodesByType = getNodesByType

/**
 * Get all type names from redux store.
 *
 * @returns {Array}
 */
const getTypes = () => Array.from(store.getState().nodesByType.keys())

exports.getTypes = getTypes

/**
 * Determine if node has changed.
 *
 * @param {string} id
 * @param {string} digest
 * @returns {boolean}
 */
exports.hasNodeChanged = (id, digest) => {
  const node = store.getState().nodes.get(id)
  if (!node) {
    return true
  } else {
    return node.internal.contentDigest !== digest
  }
}

/**
 * Get node and save path dependency.
 *
 * @param {string} id
 * @param {string} path
 * @returns {Object} node
 */
exports.getNodeAndSavePathDependency = (id, path) => {
  const createPageDependency = require(`./actions/add-page-dependency`)
  const node = getNode(id)
  createPageDependency({ path, nodeId: id })
  return node
}

exports.saveResolvedNodes = async (nodeTypeNames, resolver) => {
  for (const typeName of nodeTypeNames) {
    const nodes = store.getState().nodesByType.get(typeName)
    const resolvedNodes = new Map()
    if (nodes) {
      for (const node of nodes.values()) {
        const resolved = await resolver(node)
        resolvedNodes.set(node.id, resolved)
      }
      store.dispatch({
        type: `SET_RESOLVED_NODES`,
        payload: {
          key: typeName,
          nodes: resolvedNodes,
        },
      })
    }
  }
}

/**
 * Get node and save path dependency.
 *
 * @param {string} typeName
 * @param {string} id
 * @returns {Object|void} node
 */
const getResolvedNode = (typeName, id) => {
  const { nodesByType, resolvedNodesCache } = store.getState()
  const nodes /*: Map<mixed> */ = nodesByType.get(typeName)

  if (!nodes) {
    return null
  }

  let node = nodes.get(id)

  if (!node) {
    return null
  }

  const resolvedNodes = resolvedNodesCache.get(typeName)

  if (resolvedNodes) {
    node.__gatsby_resolved = resolvedNodes.get(id)
  }

  return node
}

exports.getResolvedNode = getResolvedNode

const addResolvedNodes = (typeName, arr) => {
  const { nodesByType, resolvedNodesCache } = store.getState()
  const nodes /*: Map<mixed> */ = nodesByType.get(typeName)

  if (!nodes) {
    return
  }

  const resolvedNodes = resolvedNodesCache.get(typeName)

  nodes.forEach(node => {
    if (resolvedNodes) {
      node.__gatsby_resolved = resolvedNodes.get(node.id)
    }
    arr.push(node)
  })
}

exports.addResolvedNodes = addResolvedNodes

let mappedByKey

const ensureIndexByTypedKey = (key, nodeTypeNames) => {
  const isField = key.startsWith("fields/")
  const sanitizedKey = (isField ? key.slice('fields/'.length) : key)
  key = nodeTypeNames.join(',') + '/' + key;

  const {nodes, resolvedNodesCache} = store.getState()

  if (!mappedByKey) {
    mappedByKey = new Map
  }

  let byKeyValue = mappedByKey.get(key)
  if (byKeyValue) {
    return
  }

  byKeyValue = new Map() // Map<node.value, Set<all nodes with this value for this key>>
  mappedByKey.set(key, byKeyValue)

console.log('starting looop for', sanitizedKey, key)
  let x = true
  nodes.forEach((node, id) => {
    if (!nodeTypeNames.includes(node.internal.type)) {
      return
    }

    // console.log('id=',id)
    // if (x) {
    //   console.log('first node:', node)
    //   x = false
    // }
    // console.log('getting v')

    let v = isField ? node.fields?.[sanitizedKey] : node[sanitizedKey]
    if (v === undefined) {
      // console.log(' --- did not have value')
      return;
    }

    // console.log('getting set')
    let set = byKeyValue.get(v)
    // console.log('checking set')
    if (!set) {
      set = new Set()
      byKeyValue.set(v, set)
    }
    // console.log('setting node')
    set.add(node)

    if (!node.__gatsby_resolved) {
      const typeName = node.internal.type;
      const resolvedNodes = resolvedNodesCache.get(typeName)
      node.__gatsby_resolved = resolvedNodes?.get(node.id)
    }
  })

  // console.log('--> mappedByKey', mappedByKey)
}

exports.ensureIndexByTypedKey = ensureIndexByTypedKey

const ensureIndexByTypedField = (fieldName, nodeTypeNames) => ensureIndexByTypedKey("fields/" + fieldName, nodeTypeNames)

exports.ensureIndexByTypedField = ensureIndexByTypedField

const getNodesByTypedKey = (key, value, nodeTypeNames) => {
  if (key === "id") {
    const node = getNode(value)

    if (nodeTypeNames.includes(value.internal.type)) {
      return node
    }

    return undefined
  }

  key = nodeTypeNames.join(',')+'/'+key;

  let byKey = mappedByKey?.get(key)

  // console.log('by key', key, '-->', byKey)
  //
  // console.log('by value', value, '->', byKey?.get(value))
  return byKey?.get(value)
}

const getNodesByField = (fieldName, fieldValue, nodeTypeNames) => getNodesByTypedKey(`fields/${fieldName}`, fieldValue, nodeTypeNames)

exports.getNodesByTypedField = getNodesByField
