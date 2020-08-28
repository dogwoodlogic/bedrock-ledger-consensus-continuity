/*!
 * Copyright (c) 2017-2018 Digital Bazaar, Inc. All rights reserved.
 */
'use strict';

const _ = require('lodash');
const brLedgerNode = require('bedrock-ledger-node');
const async = require('async');
const cache = require('bedrock-redis');
const {callbackify} = require('util');
const helpers = require('./helpers');
const mockData = require('./mock.data');

const TEST_TIMEOUT = 300000;

// NOTE: the tests in this file are designed to run in series
// DO NOT use `it.only`

const opTemplate = mockData.operations.alpha;

// NOTE: alpha is assigned manually
// NOTE: all these may not be used
const nodeLabels = [
  'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta', 'iota'
];
const nodes = {};
const peers = {};
const heads = {};

describe('Cache Recovery', () => {
  before(async function() {
    this.timeout(TEST_TIMEOUT);
    await helpers.prepareDatabase(mockData);
  });

  const nodeCount = 6;
  describe(`Consensus with ${nodeCount} Nodes`, () => {

    // override elector selection to force cycling and 3f+1
    before(() => {
      const electorSelectionApi = brLedgerNode.use('MostRecentParticipants');
      electorSelectionApi.api.getBlockElectors = async ({blockHeight}) => {
        const candidates = [];
        for(const p of Object.keys(peers)) {
          candidates.push({id: peers[p]});
        }
        const f = Math.floor((nodeCount - 1) / 3);
        const count = 3 * f + 1;
        // cycle electors deterministically using `blockHeight`
        const start = blockHeight % candidates.length;
        const electors = candidates.slice(start, start + count);
        if(electors.length < count) {
          electors.push(...candidates.slice(0, count - electors.length));
        }
        return {electors};
      };
    });

    // get consensus plugin and create genesis ledger node
    let consensusApi;
    const mockAccount = mockData.accounts.regularUser;
    const ledgerConfiguration = mockData.ledgerConfiguration;
    before(function(done) {
      this.timeout(TEST_TIMEOUT);
      async.auto({
        clean: callback => cache.client.flushall(callback),
        consensusPlugin: ['clean', (results, callback) => helpers.use(
          'Continuity2017', callback)],
        ledgerNode: ['clean', (results, callback) => {
          brLedgerNode.add(null, {ledgerConfiguration}, (err, ledgerNode) => {
            if(err) {
              return callback(err);
            }
            nodes.alpha = ledgerNode;
            callback(null, ledgerNode);
          });
        }]
      }, (err, results) => {
        assertNoError(err);
        consensusApi = results.consensusPlugin.api;
        done();
      });
    });

    // get genesis record (block + meta)
    let genesisRecord;
    before(function(done) {
      this.timeout(TEST_TIMEOUT);
      nodes.alpha.blocks.getGenesis((err, result) => {
        assertNoError(err);
        genesisRecord = result.genesisBlock;
        done();
      });
    });

    // add N - 1 more private nodes
    before(function(done) {
      this.timeout(TEST_TIMEOUT);
      async.times(nodeCount - 1, (i, callback) => {
        brLedgerNode.add(null, {
          genesisBlock: genesisRecord.block,
          owner: mockAccount.account.id
        }, (err, ledgerNode) => {
          assertNoError(err);
          nodes[nodeLabels[i]] = ledgerNode;
          callback();
        });
      }, err => {
        assertNoError(err);
        done();
      });
    });

    // populate peers and init heads
    before(function(done) {
      this.timeout(TEST_TIMEOUT);
      async.eachOf(nodes, (ledgerNode, i, callback) =>
        consensusApi._voters.get(
          {ledgerNodeId: ledgerNode.id}, (err, result) => {
            assertNoError(err);
            peers[i] = result.id;
            ledgerNode._peerId = result.id;
            heads[i] = [];
            callback();
          }),
      err => {
        assertNoError(err);
        done();
      });
    });

    describe('Check Genesis Block', () => {
      it('should have the proper information', done => {
        const blockHashes = [];
        async.auto({
          getLatest: callback => async.each(nodes, (ledgerNode, callback) =>
            ledgerNode.storage.blocks.getLatest((err, result) => {
              assertNoError(err);
              const eventBlock = result.eventBlock;
              should.exist(eventBlock.block);
              eventBlock.block.blockHeight.should.equal(0);
              eventBlock.block.event.should.be.an('array');
              eventBlock.block.event.should.have.length(2);
              const event = eventBlock.block.event[0];
              // TODO: signature is dynamic... needs a better check
              delete event.signature;
              delete event.proof;
              event.ledgerConfiguration.should.deep.equal(ledgerConfiguration);
              should.exist(eventBlock.meta);
              should.exist(eventBlock.block.consensusProof);
              const consensusProof = eventBlock.block.consensusProof;
              consensusProof.should.be.an('array');
              consensusProof.should.have.length(1);
              // FIXME: make assertions about the contents of consensusProof
              // console.log('8888888', JSON.stringify(eventBlock, null, 2));
              blockHashes.push(eventBlock.meta.blockHash);
              callback();
            }), callback),
          testHash: ['getLatest', (results, callback) => {
            blockHashes.every(h => h === blockHashes[0]).should.be.true;
            callback();
          }]
        }, done);
      });
    });

    /*
     * 1. add new unique operations/records on nodes alpha, beta, gamma, delta
     * 2. run worker on *all* nodes
     * 3. repeat 1 and 2 until target block height is reached on all nodes
     * 4. ensure that blockHash for the target block height is identical on all
     * 5. settle the network, see notes on _settleNetwork
     * 6. ensure that the final blockHeight and blockHash is identical on all
     * 7. attempt to retrieve all records added in 1 from the `records` API
     */

    const targetBlockHeight = 10;

    describe(`${targetBlockHeight} Blocks`, () => {
      it('makes many more blocks', function(done) {
        this.timeout(0);
        let childlessBeforePrime;
        let outstandingMergeEventsBeforePrime;
        async.auto({
          nBlocks: callback => _nBlocks(
            {consensusApi, targetBlockHeight}, (err, result) => {
              if(err) {
                return callback(err);
              }
              console.log(
                'targetBlockHashMap',
                JSON.stringify(result, null, 2));
              _.values(result.targetBlockHashMap)
                .every(h => h === result.targetBlockHashMap.alpha)
                .should.be.true;
              callback(null, result);
            }),
          // inspect outstandingMerge key
          inspectCache: ['nBlocks', callbackify(async () => {
            outstandingMergeEventsBeforePrime =
              await _inspectOutstandingMergeEvents({nodes});
          })],
          // inspect childess hash key
          inspectCache2: ['inspectCache', callbackify(async () => {
            childlessBeforePrime = await _inspectChildless({nodes});
          })],
          flushCache: ['inspectCache2', callbackify(async () => {
            const keysBefore = await cache.client.keys('*');
            keysBefore.should.be.an('array');
            keysBefore.should.have.length.gt(0);
            await cache.client.flushdb();
            const keys = await cache.client.keys('*');
            keys.should.be.an('array');
            keys.should.have.length(0);
          })],
          primeCache: ['flushCache', callbackify(async () => {
            for(const nodeLabel in nodes) {
              const ledgerNode = nodes[nodeLabel];
              await ledgerNode.consensus._cache.prime.primeAll({ledgerNode});
            }
          })],
          afterPrime: ['primeCache', callbackify(async () => {
            // compare childless before/after prime
            const childlessAfterPrime = await _inspectChildless({nodes});
            for(const nodeLabel in childlessAfterPrime) {
              childlessAfterPrime[nodeLabel].childless.should.have.same.members(
                childlessBeforePrime[nodeLabel].childless);
              childlessAfterPrime[nodeLabel].localChildless
                .should.have.same.members(
                  childlessBeforePrime[nodeLabel].localChildless);
            }

            // compare outstanding merge events and block height before/after
            // prime
            const outstandingMergeEventsAfterPrime =
              await _inspectOutstandingMergeEvents({nodes});
            for(const nodeLabel in outstandingMergeEventsAfterPrime) {
              const {blockHeight, eventHashes} =
                outstandingMergeEventsAfterPrime[nodeLabel];
              blockHeight.should.equal(
                outstandingMergeEventsBeforePrime[nodeLabel].blockHeight);
              eventHashes.should.have.same.members(
                outstandingMergeEventsBeforePrime[nodeLabel].eventHashes);
            }
          })],
          settle: ['afterPrime', (results, callback) =>
            helpers.settleNetwork(
              {consensusApi, nodes: _.values(nodes)}, callback)],
          blockSummary: ['settle', (results, callback) =>
            _latestBlockSummary((err, result) => {
              if(err) {
                return callback(err);
              }
              const summaries = {};
              Object.keys(result).forEach(k => {
                summaries[k] = {
                  blockCollection: nodes[k].storage.blocks.collection.s.name,
                  blockHeight: result[k].eventBlock.block.blockHeight,
                  blockHash: result[k].eventBlock.meta.blockHash,
                  previousBlockHash: result[k].eventBlock.block
                    .previousBlockHash,
                };
              });
              console.log('Finishing block summaries:', JSON.stringify(
                summaries, null, 2));
              _.values(summaries).forEach(b => {
                b.blockHeight.should.equal(summaries.alpha.blockHeight);
                b.blockHash.should.equal(summaries.alpha.blockHash);
              });
              callback();
            })],
          state: ['blockSummary', (results, callback) => {
            const allRecordIds = [].concat(..._.values(
              results.nBlocks.recordIds));
            console.log(`Total operation count: ${allRecordIds.length}`);
            async.eachSeries(allRecordIds, (recordId, callback) => {
              nodes.alpha.records.get({recordId}, err => {
                // just need to ensure that there is no NotFoundError
                assertNoError(err);
                callback();
              });
            }, callback);
          }]
        }, err => {
          assertNoError(err);
          done();
        });
      });
    }); // end one block
  });
});

function _addOperations({count}, callback) {
  async.auto({
    alpha: callback => helpers.addOperation(
      {count, ledgerNode: nodes.alpha, opTemplate}, callback),
    beta: callback => helpers.addOperation(
      {count, ledgerNode: nodes.beta, opTemplate}, callback),
    gamma: callback => helpers.addOperation(
      {count, ledgerNode: nodes.gamma, opTemplate}, callback),
    delta: callback => helpers.addOperation(
      {count, ledgerNode: nodes.delta, opTemplate}, callback),
  }, callback);
}

async function _inspectChildless({nodes}) {
  const report = {};
  for(const nodeLabel in nodes) {
    const ledgerNode = nodes[nodeLabel];
    const ledgerNodeId = ledgerNode.id;
    const {consensus: {_cache: {cacheKey: _cacheKey}}} = ledgerNode;
    const childlessKey = _cacheKey.childless(ledgerNodeId);
    const localChildlessKey = _cacheKey.localChildless(ledgerNodeId);
    const childlessKeys = await cache.client.smembers(childlessKey);
    const localChildlessKeys = await cache.client.smembers(localChildlessKey);
    const childlessHashesCache = [];
    const localChildlessHashesCache = [];
    for(const key of childlessKeys) {
      childlessHashesCache.push(key.substr(key.lastIndexOf('|') + 1));
    }
    for(const key of localChildlessKeys) {
      localChildlessHashesCache.push(key.substr(key.lastIndexOf('|') + 1));
    }
    const {childless, localChildless} = await ledgerNode.consensus._cache.prime
      .getChildlessEvents({ledgerNode});
    childlessHashesCache.should.have.same.members(childless);
    localChildlessHashesCache.should.have.same.members(localChildless);
    report[nodeLabel] = {childless, localChildless};
  }
  return report;
}

async function _inspectOutstandingMergeEvents({nodes}) {
  const report = {};
  for(const nodeLabel in nodes) {
    report[nodeLabel] = {};
    const ledgerNode = nodes[nodeLabel];
    const ledgerNodeId = ledgerNode.id;

    // test blockHeight
    const cacheBlockHeight = await ledgerNode.consensus._cache.blocks
      .blockHeight(ledgerNodeId);
    // get blockHeight from latestSummary
    const {eventBlock: {block: {blockHeight}}} = await ledgerNode
      .storage.blocks.getLatestSummary();
    cacheBlockHeight.should.equal(blockHeight);
    report[nodeLabel].blockHeight = blockHeight;

    const {consensus: {_cache: {cacheKey: _cacheKey}}} = ledgerNode;
    const outstandingMergeKey = _cacheKey.outstandingMerge(
      ledgerNodeId);
    const keys = await cache.client.smembers(outstandingMergeKey);
    keys.every(k => k.startsWith('ome')).should.be.true;
    if(keys.length > 0) {
      const keyPrefix = keys[0].substr(0, keys[0].lastIndexOf('|') + 1);
      const eventKeysInCache = await cache.client.keys(`${keyPrefix}*`);
      eventKeysInCache.should.have.same.members(keys);
    }

    const eventHashes = [];
    for(const key of keys) {
      eventHashes.push(key.substr(key.lastIndexOf('|') + 1));
    }
    // get events from mongodb
    const result = await ledgerNode.storage.events.collection.find({
      'meta.continuity2017.type': 'm',
      'meta.consensus': false
    }).project({
      _id: 0,
      'meta.eventHash': 1,
    }).toArray();
    const mongoEventHashes = result.map(r => r.meta.eventHash);
    eventHashes.should.have.same.members(mongoEventHashes);
    report[nodeLabel].eventHashes = eventHashes;
  }
  return report;
}

function _latestBlockSummary(callback) {
  const blocks = {};
  async.eachOf(nodes, (ledgerNode, nodeName, callback) => {
    ledgerNode.storage.blocks.getLatestSummary((err, result) => {
      blocks[nodeName] = result;
      callback();
    });
  }, err => callback(err, blocks));
}

function _nBlocks({consensusApi, targetBlockHeight}, callback) {
  const recordIds = {alpha: [], beta: [], gamma: [], delta: []};
  const targetBlockHashMap = {};
  async.until(() => {
    return Object.keys(targetBlockHashMap).length ===
      Object.keys(nodes).length;
  }, callback => {
    const count = 1;
    async.auto({
      operations: callback => _addOperations({count}, callback),
      workCycle: ['operations', (results, callback) => {
        // record the IDs for the records that were just added
        for(const n of ['alpha', 'beta', 'gamma', 'delta']) {
          for(const opHash of Object.keys(results.operations[n])) {
            recordIds[n].push(results.operations[n][opHash].record.id);
          }
        }
        // in this test `nodes` is an object that needs to be converted to
        // an array for the helper
        helpers.runWorkerCycle(
          {consensusApi, nodes: _.values(nodes), series: false}, callback);
      }],
      report: ['workCycle', (results, callback) => async.forEachOfSeries(
        nodes, (ledgerNode, i, callback) => {
          ledgerNode.storage.blocks.getLatestSummary((err, result) => {
            if(err) {
              return callback(err);
            }
            const {block} = result.eventBlock;
            if(block.blockHeight >= targetBlockHeight) {
              return ledgerNode.storage.blocks.getByHeight(
                targetBlockHeight, (err, result) => {
                  if(err) {
                    return callback(err);
                  }
                  targetBlockHashMap[i] = result.meta.blockHash;
                  callback();
                });
            }
            callback();
          });
        }, callback)]
    }, err => {
      if(err) {
        return callback(err);
      }
      callback();
    });
  }, err => {
    if(err) {
      return callback(err);
    }
    callback(null, {recordIds, targetBlockHashMap});
  });
}
