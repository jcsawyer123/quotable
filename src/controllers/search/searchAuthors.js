const toLower = require('lodash/toLower')
const words = require('lodash/words')
const last = require('lodash/last')
const dropRight = require('lodash/dropRight')
const clamp = require('lodash/clamp')
const createError = require('http-errors')
const Authors = require('../../models/Authors')
const toBoolean = require('../utils/toBoolean')
/**
 * Search for authors by name
 *
 * This feature is intended to power a search bar that displays autocomplete
 * suggestions as the user types.
 *
 * ### Features
 *
 * - User can search for authors by first name, last name, or full name
 * - The API will provide autocomplete suggestions (optional)
 * - Fuzzy search to accommodate minor misspellings (optional)
 * - Results are sorted based on text matching score (how well they match the
 *   search terms).
 * - Things like middle name, middle initial, prefixes, and suffixes are not
 *   required for a name to match. However, they will increase the score of
 *   a result if they do match.
 * - Ignores punctuation, and case, and diacritics
 *
 * @param {Object} req
 * @param {Object} req.query
 * @param {string} req.query.query the search query
 * @param {Object} [req.query.autocomplete = true] Enable autocomplete
 * @param {number} [req.query.fuzzyMaxEdits = 0] The number of characters
 *     per word that can be incorrect
 * @param {Object} [req.query.limit = 20] results per page
 * @param {Object} [req.query.skip = 20] offset for pagination
 */
module.exports = async function searchAuthors(req, res, next) {
  try {
    let { query = '', autocomplete = true, limit = 20, skip = 0 } = req.query

    // Sanitize params
    query = toLower(query)
    limit = clamp(limit, 0, 50) || 20
    skip = clamp(skip, 0, 1e3) || 0
    autocomplete = toBoolean(autocomplete) && !req.query.query.endsWith(' ')

    if (!query) {
      // If the query param is empty, responds with empty results
      res.json({ totalCount: 0, count: 0, lastItemIndex: null, results: [] })
    }

    // The array of fields to search
    // It searches both `name` and `aka`, which is an array of alternate names
    const path = ['name', 'aka']

    // The Search query conditions
    // @see https://docs.atlas.mongodb.com/reference/atlas-search/compound/
    const must = []
    const should = []

    // `searchTerms` is an array of the individual words in the query.
    // Each term is part of a person's name: first, middle, last, etc.
    // If autocomplete is enabled...
    // We will use prefix matching for the last word in the query. This is
    // based on the assumption that the user is typing the query continuously
    // from left to right, so all words except the last one are complete words.
    // We exclude the last word from the `searchTerms` array.
    const searchTerms = autocomplete ? dropRight(words(query)) : words(query)

    if (autocomplete) {
      // If autocomplete is enabled...
      // we use prefix matching for the last word in the query.
      must.push({
        term: {
          path,
          query: last(words(query)),
          prefix: true,
        },
      })
    }

    if (searchTerms.length >= 1) {
      // If the `query` consists of more than one term...
      // At least one of the complete terms must match the name.
      must.push({
        term: {
          path,
          query: searchTerms,
          fuzzy: { maxEdits: 1, prefixLength: 2 },
        },
      })
    }

    // 1. Fetch the paginated list of results
    // 2. Get the total number of documents that match the search
    const [results, [{ totalCount = 0 } = {}]] = await Promise.all([
      Authors.aggregate([
        { $searchBeta: { compound: { should, must } } },
        { $project: { __v: 0, aka: 0 } },
        { $skip: parseInt(skip) || 0 },
        { $limit: parseInt(limit) },
      ]),
      Authors.aggregate([
        { $searchBeta: { compound: { should, must } } },
        { $count: 'totalCount' },
      ]),
    ])

    const count = results.length
    const lastItemIndex = skip + count <= totalCount ? skip + count : null

    res.status(200).json({ totalCount, count, lastItemIndex, results })
  } catch (error) {
    return next(error)
  }
}
