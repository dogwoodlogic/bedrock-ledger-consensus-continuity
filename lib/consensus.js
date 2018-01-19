/*
 * Web Ledger Continuity2017 consensus election functions.
 *
 * Copyright (c) 2017-2018 Digital Bazaar, Inc. All rights reserved.
 */
const _ = require('lodash');
const logger = require('./logger');

// module API
const api = {};
module.exports = api;

// exposed for testing
api._getElectorBranches = _getElectorBranches;
api._findMergeEventProof = _findMergeEventProof;

/**
 * Determine if any new merge events have reached consensus in the given
 * history summary of merge events w/o consensus.
 *
 * @param ledgerNode the local ledger node.
 * @param history recent history rooted at the ledger node's local branch
 *          including ONLY merge events, it must NOT include local regular
 *          events.
 * @param electors the current electors.
 *
 * @return `null` if no consensus was found or an object `result` if it has,
 *          where:
 *            result.eventHashes the hashes of events that have reached
 *              consensus.
 *            result.consensusProofHashes the hashes of events proving
 *              consensus.
 */
api.findConsensus = ({ledgerNode, history, blockHeight, electors}) => {
  // TODO: Note: once computed, merge event Y+X candidates for each
  //   elector can be cached for quick retrieval in the future without
  //   the need to recompute them (they never change) for a given block...
  //   so the next blockHeight, elector, and X pair (its hash) could be
  //   stored in the continuity2017 meta for each candidate merge event Y
  logger.debug('Start sync _getElectorBranches, branches', {electors});
  let startTime = Date.now();
  const tails = _getElectorBranches({history, electors});
  logger.debug('End sync _getElectorBranches', {
    duration: Date.now() - startTime
  });
  logger.debug('Start sync _findMergeEventProof');
  //console.log('Start sync _findMergeEventProof');
  startTime = Date.now();
  const proof = _findMergeEventProof(
    {ledgerNode, tails, blockHeight, electors});
  /*console.log('End sync _findMergeEventProof', {
    duration: Date.now() - startTime
  });*/
  logger.debug('End sync _findMergeEventProof', {
    startTime: Date.now() - startTime
  });
  if(proof.consensus.length === 0) {
    logger.debug('findConsensus no proof found, exiting');
    return null;
  }
  logger.debug('findConsensus proof found, proceeding...');
  const allXs = proof.consensus.map(p => p.x);
  const consensusProofHashes = _.uniq(
    proof.consensus.reduce((aggregator, current) => {
      aggregator.push(...current.proof.map(r => r.eventHash));
      return aggregator;
    }, []));
  const eventHashes = _getAncestorHashes({ledgerNode, allXs});

  // return event and consensus proof hashes
  return {
    eventHashes,
    consensusProofHashes,
  };
};

/**
 * Calculate a two thirds majority of electors. When electors <= 3, every
 * elector must agree.
 *
 * @param electorCount the total number of electors.
 *
 * @return the number of electors that constitute a two thirds majority.
 */
api.twoThirdsMajority = electorCount => (electorCount <= 3) ? electorCount :
  Math.floor(electorCount / 3) * 2 + 1;

/**
 * Converts the given view of history from one particular ledger node's
 * perspective into the views for each of the given electors.
 *
 * @param history recent history.
 * @param electors the current electors.
 *
 * @return a map of containing electorId => an array containing the elector's
 *           branch of history starting at its earliest merge event, i.e.
 *           the array contains the tail event created by the elector (but an
 *           array is used because there may be more than tail, to account for
 *           byzantine behavior).
 */
function _getElectorBranches({history, electors}) {
  if(history === undefined || electors === undefined) {
    throw new TypeError('`history` and `electors` are required.');
  }
  const electorTails = {};
  const electorSet = new Set(electors.map(e => e.id));

  // find elector tails and build _treeParent index
  for(const e of history.events) {
    const creator = _getCreator(e);
    if(electorSet.has(creator)) {
      // find parent from the same branch
      const treeHash = e.event.treeHash;
      e._treeParent = _.find(e._parents, p => p.eventHash === treeHash) || null;
      if(e._treeParent) {
        if(!e._treeParent._treeChildren) {
          e._treeParent._treeChildren = [e];
        } else {
          e._treeParent._treeChildren.push(e);
        }
      } else {
        // event has no tree parent, so it is a tail (the earliest event in
        // recent history created by the elector)
        if(creator in electorTails) {
          // note that there is only one tail for correct nodes but we must
          // account here for byzantine nodes reporting more than one
          electorTails[creator].push(e);
        } else {
          electorTails[creator] = [e];
        }
      }
    }
  }

  // set generations for each branch
  for(const elector in electorTails) {
    let generation = 1;
    let next = electorTails[elector];
    while(next.length > 0) {
      const current = next;
      next = [];
      for(const event of current) {
        event._generation = generation;
        next.push(...(event._treeChildren || []));
      }
      generation++;
    }
  }

  return electorTails;
}

// FIXME: documentation
function _getAncestorHashes({allXs, ledgerNode}) {
  // get all ancestor hashes from every consensus X
  const hashes = new Set();
  const descendants = new Set();
  for(const x of allXs) {
    // TODO: anything missed or different here with byzantine forks?
    let next = [x];
    while(next.length > 0) {
      const current = next;
      next = [];
      for(const event of current) {
        if(descendants.has(event)) {
          continue;
        }
        descendants.add(event);
        hashes.add(event.eventHash);
        // ensure all regular events are added
        event.event.parentHash.forEach(hash => hashes.add(hash));
        if(event._parents) {
          next.push(...event._parents);
        }
      }
    }
  }
  return [...hashes];
}

function _getCreator(event) {
  let creator = _.get(event, 'meta.continuity2017.creator');
  if(!creator) {
    creator = event._children[0].meta.continuity2017.creator;
    event.meta = {continuity2017: {creator}};
  }
  return creator;
}

/**
 * Find consensus merge event Ys that have ancestors from a supermajority of
 * electors that are descendants of merge event Xs, where merge event Xs include
 * ancestors from a supermajority of electors. This indicates that merge event
 * Xs have both endorsed a merge events from a supermajority of electors and
 * they have been shared with a supermajority of electors because merge event Ys
 * include endorsements of merge event Xs from a supermajority of electors. For
 * each Y and X combo, it means that "merge event Y proves that merge event X
 * has been endorsed by a supermajority of electors".
 *
 * To have reached consensus, there must be at least a supermajority (a number
 * that constitutes 2/3rds + 1 of the current electors) of merge event Y
 * candidates where the candidates that have reached consensus are the ones
 * that do not have any merge event Y candidates as ancestors.
 *
 * @param ledgerNode the local ledger node.
 * @param tails the tails (earliest ancestry) of linked recent history, indexed
 *          by elector ID.
 * @param electors the current set of electors.
 *
 * @return a map with `consensus` and `yCandidates`; the `consensus` key's
 *         value is an array of merge event X and Y pairs where each merge
 *         event Y and its history proves its paired merge event X has been
 *         endorsed by a super majority of electors -- another key, `proof` is
 *         also included with each pair that includes `y` and its direct
 *         ancestors until `x`, these, in total, constitute endorsements of `x`.
 */
function _findMergeEventProof({ledgerNode, tails, blockHeight, electors}) {
  let startTime = Date.now();
  logger.debug('Start sync _findMergeEventProofCandidates');
  //console.log('Start sync _findMergeEventProofCandidates');
  const candidates = _findMergeEventProofCandidates(
    {ledgerNode, tails, blockHeight, electors});
  /*console.log('End sync _findMergeEventProofCandidates', {
    duration: Date.now() - startTime
  });*/
  logger.debug('End sync _findMergeEventProofCandidates', {
    duration: Date.now() - startTime
  });
  if(!candidates) {
    // no Y candidates yet
    return {consensus: []};
  }

  const yCandidatesByElector = candidates.yByElector;
  const supermajority = api.twoThirdsMajority(electors.length);
  if(Object.keys(yCandidatesByElector).length < supermajority) {
    // insufficient Y candidates so far, supermajority not reached
    return {consensus: []};
  }

  startTime = Date.now();
  //console.log('Start sync _findConsensusMergeEventProof');
  logger.debug('Start sync _findConsensusMergeEventProof');
  const ys = _findConsensusMergeEventProof(
    {ledgerNode, xByElector: candidates.xByElector,
      yByElector: yCandidatesByElector, blockHeight, electors});
  /*console.log('End sync _findConsensusMergeEventProof', {
    duration: Date.now() - startTime
  });*/
  logger.debug('End sync _findConsensusMergeEventProof', {
    duration: Date.now() - startTime
  });
  if(ys.length === 0) {
    // no consensus yet
    return {consensus: []};
  }

  return {
    // pair Ys with Xs
    consensus: ys.map(y => {
      const x = candidates.xByElector[_getCreator(y)];
      let proof = _flattenDescendants(
        {ledgerNode, x, descendants: y._xDescendants});
      if(proof.length === 0 && supermajority === 1) {
        // always include single elector as proof; enables continuity of that
        // single elector when computing electors in the next block via
        // quick inspection of `block.consenusProof`
        proof = [x];
      }
      return {y, x, proof};
    }),
    // return all yCandidates for debugging purposes
    yCandidates: _.values(yCandidatesByElector)
  };
}

/**
 * Find the next merge events Y candidates for each elector that has ancestors
 * from a supermajority of electors that are descendants of merge events X,
 * where merge events X include ancestors from a supermajority of electors.
 * These merge events provide proof that other merge events have been
 * approved by a consensus of electors. In order to be a candidate, a merge
 * event must also have descendants from a supermajority of electors,
 * demonstrating that it could achieve consensus as proof.
 *
 * For a given Y and X, X has both endorsed merge events from a supermajority
 * of electors and it has been shared with a supermajority of electors because
 * Y includes endorsements of X from a supermajority of electors. It means that
 * "merge event Y proves that merge event X has been endorsed by a
 * supermajority of electors".
 *
 * Both Y and X must be created by each elector ("branch-native"). Therefore,
 * each elector will produce a single unique Y and X combination (or none at
 * all).
 *
 * @param ledgerNode the local ledger node.
 * @param tails the tails (earliest ancestry) of linked recent history, indexed
 *          by elector ID.
 * @param electors the current set of electors.
 *
 * @return `null` or a map containing `yByElectors` and `xByElectors`; in
 *           `yByElectors`, each elector maps to merge event Y that proves a
 *           merge event X has been endorsed by a super majority of electors,
 *           where X and Y are branch-native.
 */
function _findMergeEventProofCandidates(
  {ledgerNode, tails, blockHeight, electors}) {
  const supermajority = api.twoThirdsMajority(electors.length);

  //console.log('TAILS', util.inspect(tails, {depth:10}));

  const electorsWithTails = Object.keys(tails);
  // TODO: ensure logging `electorsWithTails` is not slow
  /*logger.verbose('Continuity2017 electors with tails for ledger node ' +
    ledgerNode.id + ' with required supermajority ' + supermajority,
    {ledgerNode: ledgerNode.id, electorsWithTails});*/
  /*console.log('Continuity2017 electors with tails for ledger node ' +
    ledgerNode.id + ' with required supermajority ' + supermajority,
    {ledgerNode: ledgerNode.id, electorsWithTails});*/
  if(electorsWithTails.length < supermajority) {
    // non-consensus events from a supermajority of electors have not yet
    // been collected, so return early
    return null;
  }

  /* Algorithm:

  For each elector, find the earliest branch-native merge event X that includes
  ancestors from a supermajority of electors. Then, for each elector, find
  merge event Y that ensures a supermajority of other merge events endorse its
  merge event X.

  If a supermajority of electors find a merge event Y, then another algorithm
  must be run such that the electors will pick the same merge events Y. */

  const xByElector = {};
  const yByElector = {};

  // find merge event X candidate for each elector
  let startTime = Date.now();
  logger.debug('Start sync _findMergeEventProofCandidates: Xs');
  for(const elector of electorsWithTails) {
    //console.log('FINDING X for', elector);
    // TODO: safely skip electors with multiple tails detected (byzantine)?
    const electorTails = tails[elector];
    if(electorTails.length !== 1) {
      continue;
    }

    // TODO: simplify code or make generic to handle N iters before selecting
    //   an `x` where 0 is the default, i.e. tail is `x`
    // use elector tail as
    const descendants = {};
    const result = electorTails[0];
    /* // find earliest `x` for the elector's tail
    const result = _findDiversePedigreeMergeEvent(
      {ledgerNode, x: electorTails[0], electors, supermajority, descendants});*/
    if(result) {
      //console.log('***X found for', elector, ' at generation ',
      //  result._generation, result);
      xByElector[elector] = result;
      // include `result` in initial descendants map, it is used to halt
      // searches for Y and in producing the set of events to include in a
      // block should an X be selected
      descendants[result.eventHash] = [];
      result._initDescendants = descendants;
    } else {
      //console.log('***NO X found for ' + elector);
    }
  }
  logger.debug('End sync _findMergeEventProofCandidates: Xs', {
    duration: Date.now() - startTime
  });

  // TODO: ensure logging `xByElector` is not slow
  /*logger.verbose('Continuity2017 X merge events found for ledger node ' +
    ledgerNode.id, {ledgerNode: ledgerNode.id, xByElector});*/
  /*console.log('Continuity2017 X merge events found for ledger node ' +
    ledgerNode.id, {ledgerNode: ledgerNode.id, xByElector});*/

  if(Object.keys(xByElector).length < supermajority) {
    // non-consensus events X from a supermajority of electors have not yet
    // been collected, so return early
    return null;
  }

  // find merge event Y candidate for each elector
  startTime = Date.now();
  logger.debug('Start sync _findMergeEventProofCandidates: Y candidates');
  for(const elector in xByElector) {
    const x = xByElector[elector];
    const descendants = {};
    //console.log('FINDING Y FOR X', x, elector);
    // pass `x._initDescendants` as the ancestry map to use to short-circuit
    // searches as it includes all ancestors of X -- which should not be
    // searched when finding a Y because they cannot lead to X
    const result = _findDiversePedigreeMergeEvent(
      {ledgerNode, x, electors, supermajority, descendants,
        ancestryMap: x._initDescendants});
    if(result) {
      yByElector[elector] = result;
      result._xDescendants = descendants;
    }
  }
  logger.debug('End sync _findMergeEventProofCandidates: Y candidates', {
    duration: Date.now() - startTime
  });

  // TODO: ensure logging `yByElector` is not slow
  /*logger.verbose(
    'Continuity2017 Y merge event candidates found for ledger node ' +
    ledgerNode.id, {ledgerNode: ledgerNode.id, yByElector});*/
  /*console.log(
    'Continuity2017 Y merge event candidates found for ledger node ' +
    ledgerNode.id, {ledgerNode: ledgerNode.id, blockHeight, yByElector});*/

  return {yByElector, xByElector};
}

/**
 * Find the earliest merge event for an elector that includes an ancestry of
 * merge events from at least a supermajority of electors. This merge event is
 * said to have a "diverse pedigree" and indicates that another event is
 * well-endorsed. The search starts at the oldest event in history on a
 * particular elector branch (this constitutes generation `1`) and proceeds
 * forward through history.
 *
 * @param ledgerNode the current ledger node, used for logging.
 * @param x the event in history to begin searching at.
 * @param electors all current electors.
 * @param supermajority the number that constitutes a supermajority of electors.
 * @param descendants an optional map of event hash to descendants that is
 *          populated as they are found.
 * @param ancestryMap an optional map of event hash to ancestors of `x` that is
 *          used to short-circuit searching.
 *
 * @return the earliest merge event with a diverse pedigree.
 */
function _findDiversePedigreeMergeEvent(
  {ledgerNode, x, electors, supermajority, descendants = {},
  ancestryMap = _buildAncestryMap(x)}) {
  //console.log('EVENT', x.eventHash);

  if(supermajority === 1) {
    // trivial case, return `x`
    return x;
  }

  if(!(x._treeChildren && x._treeChildren.length === 1)) {
    // byzantine node or no children when supermajority > 1, abort
    return null;
  }

  const electorSet = new Set(electors.map(e => e.id));

  let treeDescendant = x._treeChildren[0];
  //console.log('FINDING descendant for: ', x.eventHash);
  //console.log('X creator', _getCreator(x));
  while(treeDescendant) {
    //console.log();
    //console.log('checking generation', treeDescendant._generation);
    //console.log('treeDescendant hash', treeDescendant.eventHash);
    // add all descendants of `x` that are ancestors of `treeDescendant`
    _findDescendantsInPath(
      {ledgerNode, x, y: treeDescendant, descendants, ancestryMap});

    // see if there are a supermajority of endorsements of `x` now
    if(_hasSufficientEndorsements(
      {ledgerNode, x, descendants, electorSet, supermajority})) {
      //console.log('supermajority of endorsements found at generation', treeDescendant._generation);
      //console.log();
      return treeDescendant;
    }
    //console.log('not enough endorsements yet at generation', treeDescendant._generation);
    // FIXME: remove me
    //const ancestors = _flattenDescendants({ledgerNode, x, descendants});
    //console.log('total descendants so far', ancestors.map(r=>({
    //  creator: _getCreator(r),
    //  generation: r._generation,
    //  hash: r.eventHash
    //})));
    //console.log();

    if(!(treeDescendant._treeChildren &&
      treeDescendant._treeChildren.length === 1)) {
      // byzantine node or no children, abort
      return null;
    }

    treeDescendant = treeDescendant._treeChildren[0];
  }

  return null;
}

function _findConsensusMergeEventProof(
  {ledgerNode, xByElector, yByElector, blockHeight, electors}) {
  /*logger.verbose(
    'Continuity2017 looking for consensus merge proof for ledger node ' +
    ledgerNode.id, {ledgerNode: ledgerNode.id});*/
  /*console.log(
    'Continuity2017 looking for consensus merge proof for ledger node ' +
    ledgerNode.id, {ledgerNode: ledgerNode.id});*/

  const allYs = _.values(yByElector);

  // if electors is 1, consensus is trivial
  if(electors.length === 1) {
    return allYs;
  }

  // build map of each Y's ancestry for quick checks of halting conditions
  const yAncestryMaps = _buildAncestryMaps(allYs);
  for(const y of allYs) {
    // include all known initial and X descendants in ancestry map
    const map = yAncestryMaps[y.eventHash];
    for(let hash in y._xDescendants) {
      map[hash] = true;
    }
    const x = xByElector[_getCreator(y)];
    for(let hash in x._initDescendants) {
      map[hash] = true;
    }
  }

  // initialize all Y votes
  allYs.forEach(y => {
    // track Ys for easy unioning
    y._y = y;
    const supporting = _allEndorsedYs({event: y, allYs, yAncestryMaps});
    // always include self
    supporting.add(y);
    y._votes = {};
    supporting.forEach(supported => {
      y._votes[_getCreator(supported)] = supported;
    });
  });

  let startTime = Date.now();
  logger.debug('Start sync _findConsensusMergeEventProof: _tallyBranches');
  //console.log('Start sync _findConsensusMergeEventProof: _tallyBranches');
  // go through each Y's branch looking for consensus
  let consensus = _tallyBranches({ledgerNode, yByElector, blockHeight, electors});
  /*console.log('End sync _findConsensusMergeEventProof: _tallyBranches', {
    duration: Date.now() - startTime
  });*/
  logger.debug('End sync _findConsensusMergeEventProof: _tallyBranches', {
    duration: Date.now() - startTime
  });

  if(consensus) {
    // TODO: ensure logging `consensus` is not slow
    /*logger.verbose(
      'Continuity2017 merge event proof found for ledger node ' +
      ledgerNode.id, {ledgerNode: ledgerNode.id, proof: consensus});*/
    /*console.log(
      'Continuity2017 merge event proof found for ledger node ' +
      ledgerNode.id, {ledgerNode: ledgerNode.id, proof: consensus});*/
  }

  return consensus || [];
}

/**
 * Adds all descendants found between `x` and `y`. Descendants are added to
 * a `descendants` map as they are found -- this map may contain descendants
 * that are not between `x` and `y`. To obtain the descendants that are only
 * between `x` and `y`, the `descendants` map must be traversed starting
 * with the children of `x`. Every entry in the `descendants` map is an array
 * with ancestors of `y`.
 *
 * This method may be called using a prepopulated (via a previous call of
 * this method using a different `y`) `descendants` map. This is useful for
 * iterating through the tree descendants of `x` looking for the first
 * same-tree descendant that has a supermajority of endorsements of `x`.
 *
 * TODO: Consider making `descendants` a Map, and use objects as keys rather
 * than hashes for quicker look ups and less memory usage.
 *
 * @param ledgerNode the current ledgerNode, for logging.
 * @param x the starting event to find descendants of.
 * @param y the stopping event to find ancestors of.
 * @param descendants the descendants map to use.
 * @param ancestryMap a map of the ancestry of `x` to optimize searching.
 */
function _findDescendantsInPath({
  ledgerNode, x, y, descendants = {}, ancestryMap = _buildAncestryMap(x)}) {
  // find all descendants of `x` that are ancestors of `y`
  let next = [y];
  while(next.length > 0) {
    const current = next;
    next = [];
    for(const event of current) {
      if(event.eventHash in ancestryMap) {
        //console.log('SKIPPING', event.eventHash);
        continue;
      }
      for(let parent of event._parents) {
        //console.log('event.parent', {
        //  creator: _getCreator(parent),
        //  generation: parent._generation,
        //  hash: parent.eventHash
        //});
        const d = descendants[parent.eventHash];
        if(d) {
          if(!d.includes(event)) {
            d.push(event);
          }
          //console.log('parent ALREADY in descendants', parent.eventHash);
          continue;
        }
        //console.log('ADDING parent to descendants', parent.eventHash);
        descendants[parent.eventHash] = [event];
        next.push(parent);
      }
    }
  }
  //console.log('entries in descendants', Object.keys(descendants));
}

function _flattenDescendants({ledgerNode, x, descendants}) {
  const result = [];
  let next = [x];
  while(next.length > 0) {
    const current = next;
    next = [];
    for(const event of current) {
      //console.log('_flatten event', {
      //  creator: _getCreator(event),
      //  generation: event._generation,
      //  hash: event.eventHash
      //});
      const d = descendants[event.eventHash];
      if(d) {
        // `event` is in the computed path of descendants
        next.push(...d);
      }
    }
    // TODO: can we avoid duplicated processing by checking `result`
    // for already added events?
    next = _.uniq(next);
    result.push(...next);
  }
  return _.uniq(result);
}

function _updateToMostRecentVotes(
  {ledgerNode, y, yByElector, descendants, electorSet, votes}) {
  let next = [y];
  while(next.length > 0) {
    const current = next;
    next = [];
    for(const event of current) {
      //console.log('_updateToMostRecentVotes event', {
      //  creator: _getCreator(event),
      //  generation: event._generation,
      //  hash: event.eventHash
      //});
      const d = descendants[event.eventHash];
      if(d) {
        const creator = _getCreator(event);
        if(electorSet.has(creator)) {
          // only include `event` as voting if it is >= to its associated
          // Y's generation
          if(event._generation >= yByElector[creator]._generation) {
            _useMostRecentVotingEvent(
              {ledgerNode, elector: creator, votes, votingEvent: event});
          }
        }
        // `event` is in the computed path of descendants
        next.push(...d);
      }
    }
    next = _.uniq(next);
  }
}

function _useMostRecentVotingEvent({ledgerNode, elector, votes, votingEvent}) {
  // only count vote from a particular elector once, using the most
  // recent from that elector; if an elector has two voting events
  // from the same generation, it is byzantine, invalidate its vote
  if(elector in votes) {
    const existing = votes[elector];
    if(existing === false || votingEvent === false) {
      /*logger.verbose('Continuity2017 detected byzantine node ',
        {ledgerNode: ledgerNode.id, elector});*/
    } else if(votingEvent._generation > existing._generation) {
      /*logger.verbose('Continuity2017 replacing voting event', {
        ledgerNode: ledgerNode.id,
        elector,
        votingEvent: votingEvent.eventHash
      });*/
      votes[elector] = votingEvent;
    } else if(
      votingEvent._generation === existing._generation &&
      votingEvent !== existing) {
      // byzantine node!
      /*logger.verbose('Continuity2017 detected byzantine node', {
        ledgerNode: ledgerNode.id,
        elector,
        votingEvent: votingEvent.eventHash
      });*/
      votes[elector] = false;
    }
  } else {
    /*logger.verbose('Continuity2017 found new voting event', {
      ledgerNode: ledgerNode.id,
      elector,
      votingEvent: votingEvent.eventHash
    });*/
    votes[elector] = votingEvent;
  }
}

function _hasSufficientEndorsements(
  {ledgerNode, x, descendants, electorSet, supermajority}) {
  // always count `x` as self-endorsed
  const endorsements = new Set([_getCreator(x)]);
  let total = 1;
  let next = [x];
  //console.log('checking for sufficient endorsements...');
  while(next.length > 0) {
    const current = next;
    next = [];
    for(const event of current) {
      const d = descendants[event.eventHash];
      if(d) {
        // `event` is in the computed path of descendants
        for(const e of d) {
          const creator = _getCreator(e);
          if(!endorsements.has(creator) && electorSet.has(creator)) {
            endorsements.add(creator);
            total++;
            //console.log('total', total, 'supermajority', supermajority);
            //console.log('electors', electorSet);
            //console.log('endorsements', endorsements);
            if(total >= supermajority) {
              return true;
            }
          }
        }
        next.push(...d);
      }
    }
    next = _.uniq(next);
  }
  return false;
}

function _tallyBranches({ledgerNode, yByElector, blockHeight, electors}) {
  /* Algorithm:

  1. Iterate through each Y branch, starting at Y and moving down its
     tree children.
  2. Find all descendants between the current event and every Y.
  3. Filter the descendants into a `votes` map of elector => most recent event
     created by that elector, creating the set of events that are participating
     in an experiment to see what Y candidates the various nodes are
     supporting. If a byzantine node is detected, mark the elector's entry
     as `false` and it remains that way until consensus is reached.
  4. If all of the participants are supporting some set of Y candidates,
     then compute the current tree child's supported value. Otherwise,
     continue to the next iteration of the loop. Eventually, all
     participants will support a value and the tree child's supported
     value can be computed (or consensus will be reached and the loop
     will exit early).
  5. Once a tree child is supporting a value, move onto the next tree
     child and continue until no more remain.
  */
  const electorSet = new Set(Object.keys(yByElector));
  let next = _.values(yByElector);
  while(next.length > 0) {
    const current = next;
    next = [];
    for(let event of current) {
      // propagate Ys for easy unioning
      if(event._treeParent._y) {
        event._y = event._treeParent._y;
      }
      if(!event._supporting) {
        if(!event._votes) {
          // reuse and update tree parent's votes
          // FIXME: do we need to copy or can we reuse?
          event._votes = {};
          if(event._treeParent._votes) {
            for(let elector in event._treeParent._votes) {
              event._votes[elector] = event._treeParent._votes[elector];
            }
          }
        }

        // determine ancestors that will partipicate in the experiment,
        // looking at descendants of every Y
        if(!event._yDescendants) {
          if(event._treeParent._yDescendants) {
            event._yDescendants = event._treeParent._yDescendants;
          } else {
            event._yDescendants = {};
            electorSet.forEach(e => event._yDescendants[e] = {});
          }
        }

        // TODO: could possibly optimize here -- may only need to compute
        //   most recent votes if the event is a Y, otherwise, its most
        //   recent votes cannot change even if we have to loop?

        /*let startTime = Date.now();
        console.log(
          'Start sync _findConsensusMergeEventProof: find Y descendants');*/
        for(const elector of electorSet) {
          const y = yByElector[elector];
          const descendants = event._yDescendants[elector];
          _findDescendantsInPath({
            ledgerNode,
            x: y,
            y: event,
            descendants,
            ancestryMap: y._xDescendants
          });
          /*console.log('descendants from y ' + y._generation + ' to event',
            event._generation,
            _flattenDescendants({ledgerNode, x: y, descendants}).map(r=>r._generation));*/
          _updateToMostRecentVotes(
            {ledgerNode, y, yByElector, descendants, electorSet,
              votes: event._votes});
        }
        /*console.log(
          'End sync _findConsensusMergeEventProof: find Y descendants', {
            duration: Date.now() - startTime
          });*/

        const votingEvents = _.values(event._votes);
        if(_.find(
          votingEvents, e => e && e !== event && !('_supporting' in e))) {
          // some votes are still outstanding other than ourselves are still
          // outstanding, cannot tally yet
          next.push(event);
          continue;
        }
      }

      /*let startTime = Date.now();
      console.log('Start sync _findConsensusMergeEventProof: _tally');*/
      const result = _tally({ledgerNode, event, yByElector, blockHeight, electors});
      /*console.log('End sync _findConsensusMergeEventProof: _tally', {
        duration: Date.now() - startTime
      });*/
      if(result) {
        // consensus reached
        return result;
      }

      // add tree children
      next.push(...(event._treeChildren || []));
    }
  }

  return null;
}

function _tally({ledgerNode, event, yByElector, blockHeight, electors}) {
  // TODO: technically, we only need to tally support for our next choice, so
  // this could be cleaned up or only used for logging purposes --
  // additionally, we don't need to find our previous choice amongst the tally
  // (as seen below), we only need to compare against what we will pick next
  // and see if it changed to keep an accurate count of our next choice support
  logger.verbose('Continuity2017 _tally finding votes seen...',
    {ledgerNode: ledgerNode.id, eventHash: event.eventHash});
  // tally votes
  const tally = [];
  _.values(event._votes).forEach(e => {
    if(e === false || !e._supporting) {
      // do not count byzantine votes or votes without support (initial Ys)
      return;
    }
    const tallyResult = _.find(tally, _findSetInTally(e._supporting));
    if(tallyResult) {
      // ensure same instance of set is used for faster comparisons
      e._supporting = tallyResult.set;
      tallyResult.count++;
    } else {
      tally.push({
        set: e._supporting,
        count: 1
      });
    }
  });

  // TODO: remove me
  /*console.log('==================');
  console.log('BLOCK HEIGHT', blockHeight);
  console.log('votes received at generation', event._generation);
  console.log('by experimenter', _getCreator(event).substr(-5));
  console.log('------------------');
  Object.keys(event._votes).forEach(k => {
    if(event._votes[k]._supporting) {
      console.log('|');
      console.log('|-elector:', k.substr(-5));
      console.log('  generation:', event._votes[k]._generation);
      event._votes[k]._supporting.forEach(r => {
        console.log(
          '    Y generation:', r._generation,
          ', creator:', _getCreator(r).substr(-5));
      });
    }
  });
  console.log('------------------');*/

  // TODO: ensure logging `tally` is not slow
  /*logger.verbose('Continuity2017 _tally tally',
    {ledgerNode: ledgerNode.id, tally});*/
  // TODO: remove me
  //tally.sort((a, b) => b.count - a.count);
  /*console.log('VOTE TALLY', ledgerNode.id, tally.map(t => ({
    count: t.count,
    set: JSON.stringify(t.set.map(r => r.eventHash))
  })));*/

  // prepare to compute the next choice
  let nextChoice;

  // get event creator for use below
  const creator = _getCreator(event);

  // get existing precommit on the event's branch
  let existingPreCommit;
  if(event._treeParent) {
    existingPreCommit = event._treeParent._preCommit;
  }

  /* Find the union of all ancestral current precommit event support sets,
  as long as we have our own precommit:
    Then set next choice to precommit union.
    And continue...

  Note: Only union precommits when our tree parent has one.

  Regarding precommits:

  Largest earliest precommit will always be committed.
  Worse case is `f` precommits are made that all fail, but the system
    continues on.
  You either confirm something smaller than the set of all Ys or confirm the
    set of all Ys.
  */
  if(existingPreCommit) {
    /*console.log('EXISTING PRECOMMIT FOR',
      existingPreCommit._supporting.map(r=>r._generation));*/
    const union = _findUnionPreCommitSet(event, existingPreCommit);
    nextChoice = _.find(tally, _findSetInTally(union));
  }

  /*
  If no next choice has been set:
    Then set next choice to the union of all ancestral ys (not precommits).
    And continue...
  */
  if(!nextChoice) {
    // compute the union of all ancestral ys
    const union = _.uniq(_.values(event._votes).filter(r => r).map(r => r._y));
    //console.log('choosing union', union.map(r => r._generation));

    // set the next choice to the matching tally or create it
    nextChoice = _.find(tally, _findSetInTally(union));
    if(!nextChoice) {
      // create new choice
      nextChoice = {set: union, count: 0};
    }
  }

  /*
  Get the previous choice.

  If the previous choice is different from the new choice, increment the
  new choice count.
  */
  const previousChoice = event._votes[creator] ? _.find(
    tally, _findSetInTally(event._votes[creator]._supporting)) : null;

  // if vote has changed
  if(previousChoice !== nextChoice) {
    // increment next choice count
    nextChoice.count++;
  }

  //console.log('SUPPORT IS FOR', nextChoice.set.map(r=>r._generation));

  // compute if the next choice has a supermajority
  const supermajority = api.twoThirdsMajority(electors.length);
  const hasSupermajority = nextChoice.count >= supermajority;
  // FIXME: remove me
  /*if(hasSupermajority) {
    console.log('SUPERMAJORITY VOTE DETECTED AT BLOCK', blockHeight,
      nextChoice.set.map(r => ({
        creator: _getCreator(r),
        eventHash: r.eventHash,
        generation: r._generation
      })));
  }*/
  // FIXME: remove above

  /*
  If you have an existing precommit, check support.
  */
  if(existingPreCommit) {
    // reject precommit immediately if local support does not match
    if(!_compareSupportSet(existingPreCommit._supporting, nextChoice.set)) {
      /*console.log('rejecting precommit for',
        existingPreCommit._supporting.map(r=>r._generation));*/
      if(existingPreCommit._confirmPoint) {
        existingPreCommit._confirmPoint._toConfirm = false;
      }
      existingPreCommit = null;
    } else if(event._toConfirm) {
      /*
      Local support matches AND the event is a confirm point for the existing
      precommit. So, if it has supermajority support then consensus has been
      reached.
      Otherwise, existing precommit is rejected and continue...
      */
      if(hasSupermajority) {
        // FIXME: remove me, just for debugging purposes/sanity check
        /*if(event._toConfirm !== existingPreCommit) {
          console.log('CONFIRMED NON-CURRENT PRECOMMIT!, parent supported',
            event._treeParent._preCommit._supporting.map(r => r._generation));
        }
        // consensus reached
        console.log('DECISION DETECTED AT BLOCK', blockHeight, {
          creator: _getCreator(event).substr(-5),
          eventHash: event.eventHash,
          generation: event._generation
        });
        console.log('SUPPORT WAS FOR',
          nextChoice.set.map(r => r._generation));*/
        return event._toConfirm._supporting;
      }

      // reject precommit
      existingPreCommit = null;
    }
  }

  /*
  If the next choice has a supermajority and has no existing (unrejected)
  precommit, so create a new one.
  */
  if(hasSupermajority && !existingPreCommit) {
    /*console.log('previous precommit not found, creating new one at',
      event._generation);*/
    // no preCommit yet, use current event
    existingPreCommit = event;

    // compute confirm point for the preCommit
    const ancestryMap = _buildAncestryMap(event);
    const confirmPoint = _findDiversePedigreeMergeEvent(
      {ledgerNode, x: event, electors, supermajority,
        descendants: {}, ancestryMap: ancestryMap});
    if(confirmPoint) {
      /*console.log('marking confirm point event',
        confirmPoint._generation, 'for precommit', preCommit._generation);*/
      event._confirmPoint = confirmPoint;
      event._confirmPoint._toConfirm = event;
    } else {
      // FIXME: remove me
      /*console.log('no confirm point event yet for precommit',
        _getCreator(preCommit), preCommit._generation);*/
    }
  }

  // set event's preCommit
  if(existingPreCommit) {
    event._preCommit = existingPreCommit;
  }

  // support next choice
  event._supporting = nextChoice.set;
  event._votes[creator] = event;
  return null;
}

function _findSetInTally(set) {
  if(!set) {
    return () => false;
  }
  const a = set.map(r => r.eventHash);
  return tallyResult => {
    if(tallyResult.set === set) {
      return true;
    }
    const b = tallyResult.set.map(r => r.eventHash);
    return a.length === b.length && _.difference(a, b).length === 0;
  };
}

function _compareSupportSet(set1, set2) {
  if(set1 === set2) {
    return true;
  }
  const a = set1.map(r => r.eventHash);
  const b = set2.map(r => r.eventHash);
  return a.length === b.length && _.difference(a, b).length === 0;
}

function _findUnionPreCommitSet(event, existingPrecommit) {
  // Note: The algorithm actually guarantees, via containment, that the
  // largest precommit will necessarily be the same as the union of all
  // previous precommits. This is because the earliest precommits are
  // created via support switches that are unions. Any two earliest concurrent
  // precommits have overlap where support must have come from a union.
  //
  // Only union precommits if the current node has made its own precommit,
  // otherwise regular support will be unioned instead (this function will
  // not be called). If the union results in a change of support at the merge
  // event (just locally not supermajority support of the system), then the
  // node's precommit will be rejected and the appropriate new support will
  // be adopted.
  let union = existingPrecommit._supporting;
  _.values(event._votes).forEach(r => {
    if(!(r && r._preCommit)) {
      return;
    }
    //union = _.uniq(union.concat(r._preCommit._supporting));
    const supporting = r._preCommit._supporting;
    if(supporting.length > union.length) {
      union = supporting;
    }
  });
  return union;
}

function _buildAncestryMaps(events) {
  const ancestryMaps = {};
  events.forEach(e => {
    ancestryMaps[e.eventHash] = _buildAncestryMap(e);
  });
  return ancestryMaps;
}

function _buildAncestryMap(event) {
  const map = {};
  let next = [event];
  while(next.length > 0) {
    const current = next;
    next = [];
    for(const event of current) {
      if(!(event.eventHash in map)) {
        map[event.eventHash] = true;
        if(event._parents) {
          next.push(...event._parents);
        }
      }
    }
    next = _.uniq(next);
  }
  return map;
}

function _allEndorsedYs({event, allYs, yAncestryMaps}) {
  const found = new Set();
  _hasAncestors({
    target: event,
    candidates: allYs,
    candidateAncestryMaps: yAncestryMaps,
    found
  });
  return found;
}

/**
 * Returns `true` if the `target` has `min` ancestors from `candidates`.
 *
 * @param target the event to check the ancestry of for `candidates`.
 * @param candidates the possible ancestors of `target`.
 * @param min the minimum number of candidates that must be ancestors.
 * @param candidateAncestryMaps for the search halting positions.
 * @param found a Set for tracking which candidates have been found so far.
 *
 * @return `true` if `candidate` is an ancestor of `target`, `false` if not.
 */
function _hasAncestors(
  {target, candidates, min = candidates.length,
    candidateAncestryMaps, found}) {
  const candidateSet = new Set(candidates);
  let next = target._parents;
  let difference = [...candidateSet].filter(x => !found.has(x));
  // include `checked` as an optimization to avoid double checking ancestors
  const checked = new Set();
  while(next.length > 0) {
    const current = next;
    next = [];
    for(const parent of current) {
      // skip already checked parents
      if(checked.has(parent)) {
        continue;
      }
      checked.add(parent);
      if(candidateSet.has(parent)) {
        if(!found.has(parent)) {
          found.add(parent);
          if(found.size >= min) {
            return true;
          }
          difference.splice(difference.indexOf(parent), 1);
        }
      }
      // determine if parent can be now be ruled out as leading to any further
      // discoveries by testing if it is not in at least one of the remaining
      // candidate ancestry maps
      const viable = difference.some(
        c => !(parent.eventHash in candidateAncestryMaps[c.eventHash]));
      if(viable && parent._parents) {
        next.push(...parent._parents);
      }
    }
    next = _.uniq(next);
  }

  return found.size >= min;
}