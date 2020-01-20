// @flow
const { default: sift } = require(`sift`)
const _ = require(`lodash`)
const prepareRegex = require(`../utils/prepare-regex`)
const { makeRe } = require(`micromatch`)
const { getValueAt } = require(`../utils/get-value-at`)
const {
  toDottedFields,
  objectToDottedField,
  liftResolvedFields,
} = require(`../db/common/query`)

/////////////////////////////////////////////////////////////////////
// Parse filter
/////////////////////////////////////////////////////////////////////

const prepareQueryArgs = (filterFields = {}) =>
  Object.keys(filterFields).reduce((acc, key) => {
    const value = filterFields[key]
    if (_.isPlainObject(value)) {
      acc[key === `elemMatch` ? `$elemMatch` : key] = prepareQueryArgs(value)
    } else {
      switch (key) {
        case `regex`:
          acc[`$regex`] = prepareRegex(value)
          break
        case `glob`:
          acc[`$regex`] = makeRe(value)
          break
        default:
          acc[`$${key}`] = value
      }
    }
    return acc
  }, {})

const getFilters = filters =>
  Object.keys(filters).reduce(
    (acc, key) => acc.push({ [key]: filters[key] }) && acc,
    []
  )

/////////////////////////////////////////////////////////////////////
// Run Sift
/////////////////////////////////////////////////////////////////////

function isEqId(siftArgs) {
  // The `id` of each node is invariably unique. So if a query is doing id $eq(string) it can find only one node tops
  return (
    siftArgs.length > 0 &&
    siftArgs[0].id &&
    Object.keys(siftArgs[0].id).length === 1 &&
    Object.keys(siftArgs[0].id)[0] === `$eq`
  )
}

function handleFirst(siftArgs, nodes) {
  if (nodes.length === 0) {
    return []
  }

  const index = _.isEmpty(siftArgs)
    ? 0
    : nodes.findIndex(
        sift({
          $and: siftArgs,
        })
      )

  if (index !== -1) {
    return [nodes[index]]
  } else {
    return []
  }
}

function handleMany(siftArgs, nodes, sort, resolvedFields) {
  let result = _.isEmpty(siftArgs)
    ? nodes
    : nodes.filter(
        sift({
          $and: siftArgs,
        })
      )

  if (!result || !result.length) return null

  // Sort results.
  if (sort && result.length > 1) {
    // create functions that return the item to compare on
    const dottedFields = objectToDottedField(resolvedFields)
    const dottedFieldKeys = Object.keys(dottedFields)
    const sortFields = sort.fields
      .map(field => {
        if (
          dottedFields[field] ||
          dottedFieldKeys.some(key => field.startsWith(key))
        ) {
          return `__gatsby_resolved.${field}`
        } else {
          return field
        }
      })
      .map(field => v => getValueAt(v, field))
    const sortOrder = sort.order.map(order => order.toLowerCase())

    result = _.orderBy(result, sortFields, sortOrder)
  }
  return result
}

/**
 * Filters a list of nodes using mongodb-like syntax.
 *
 * @param args raw graphql query filter as an object
 * @param nodes The nodes array to run sift over (Optional
 *   will load itself if not present)
 * @param type gqlType. Created in build-node-types
 * @param firstOnly true if you want to return only the first result
 *   found. This will return a collection of size 1. Not a single
 *   element
 * @returns Collection of results. Collection will be limited to size
 *   if `firstOnly` is true
 */
let resolvedTypes = new Set

const runSift = (args: Object) => {
  const { getNode, addResolvedNodes, getResolvedNode } = require(`./nodes`)

  const { nodeTypeNames } = args

  let shortcut

  try {
    // console.log('0/5 args.queryArgs?.filter', args.queryArgs?.filter)
    if (
      args.queryArgs?.filter
    ) {
      // console.log('1/5 there is a filter', args.queryArgs.filter)
      const filterProps = Object.getOwnPropertyNames(args.queryArgs.filter);
      if (filterProps.length === 1) {
        const filterProp = filterProps[0]
        // console.log('2/5 there is exactly one filter', filterProps, args.queryArgs.filter[filterProp])
        if (filterProp === 'fields') {
          // console.log('3/5 there is a fields', [filterProp, args.queryArgs.filter.fields])
          const fields = Object.getOwnPropertyNames(args.queryArgs.filter.fields);
          if (fields.length === 1) {
            const fieldName = fields[0];
            const fieldFilters = Object.getOwnPropertyNames(args.queryArgs.filter.fields[fieldName]);
            // console.log('4/5 there is exactly one field', [filterProp, fields, fieldName, args.queryArgs.filter.fields[fieldName], fieldFilters])
            if (fieldFilters.length === 1 && fieldFilters[0] === 'eq') {
              let targetValue = args.queryArgs.filter.fields[fieldName].eq
              // console.log('5/5 There is exactly one eq for this field so lets go!', [fieldFilters, targetValue]);

              //typeof args.queryArgs.filter?.id?.eq === `string`
              const { ensureIndexByTypedField, getNodesByTypedField } = require(`./nodes`)

              // console.log('setting up index')
              ensureIndexByTypedField(fieldName, nodeTypeNames)

              // console.log('########### for k/v:', fieldName, '/', targetValue)

              // console.log('doing fetch now')
              const nodesByKeyValue = getNodesByTypedField(fieldName, targetValue, nodeTypeNames)
              // console.log('field =', fieldName, ', value =', targetValue, ', found -->', nodesByKeyValue);
              if (nodesByKeyValue?.size > 0) {
                shortcut = [...nodesByKeyValue]
                return shortcut
              } else {
                shortcut = undefined
              }
            }
          }
        }
      }
    }
  } catch (e) {
    console.error(e.stack)
    throw new Error(e)
  }


  if (
    args.queryArgs?.filter &&
    Object.getOwnPropertyNames(args.queryArgs.filter).length === 1 &&
    typeof args.queryArgs.filter?.id?.eq === `string`
  ) {
    // The args have an id.eq which subsumes all other queries
    // Since the id of every node is unique there can only ever be one node found this way. Find it and return it.
    let id = args.queryArgs.filter.id.eq
    let node = undefined
    nodeTypeNames.some(typeName => {
      node = getResolvedNode(typeName, id)
      return !!node
    })
    if (node) {
      return [node]
    }
  }

  let nodes = []

  nodeTypeNames.forEach(typeName => addResolvedNodes(typeName, nodes))

  let actual = runSiftOnNodes(nodes, args, getNode)

  // if (args.queryArgs?.filter && actual) {
  //   console.log('->', actual[0])
  //   console.log('------')
  //   console.log('=>', shortcut?.[0])
  //   console.log('###########')
  //   console.log(actual?.[0] === shortcut?.[0])
  //   console.log('########### actual')
  //   console.log(actual?.length, nodeTypeNames);
  //   console.log('########### shortcut')
  //   console.log(shortcut?.length);
  //   console.log('########### hard exit')
  //   process.exit()
  // }

  return actual
}

exports.runSift = runSift

const runSiftOnNodes = (nodes, args, getNode) => {
  const {
    queryArgs = { filter: {}, sort: {} },
    firstOnly = false,
    resolvedFields = {},
    nodeTypeNames,
  } = args

  let siftFilter = getFilters(
    liftResolvedFields(
      toDottedFields(prepareQueryArgs(queryArgs.filter)),
      resolvedFields
    )
  )

  // If the the query for single node only has a filter for an "id"
  // using "eq" operator, then we'll just grab that ID and return it.
  if (isEqId(siftFilter)) {
    const node = getNode(siftFilter[0].id.$eq)

    if (
      !node ||
      (node.internal && !nodeTypeNames.includes(node.internal.type))
    ) {
      if (firstOnly) return []
      return null
    }

    return [node]
  }

  if (firstOnly) {
    return handleFirst(siftFilter, nodes)
  } else {
    return handleMany(siftFilter, nodes, queryArgs.sort, resolvedFields)
  }
}

exports.runSiftOnNodes = runSiftOnNodes
