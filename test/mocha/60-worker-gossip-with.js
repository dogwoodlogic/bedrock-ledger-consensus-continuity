/*!
 * Copyright (c) 2017-2018 Digital Bazaar, Inc. All rights reserved.
 */
'use strict';

const async = require('async');
const bedrock = require('bedrock');
const brLedgerNode = require('bedrock-ledger-node');
const gossipCycle = require('./gossip-cycle');
const helpers = require('./helpers');
const mockData = require('./mock.data');
const uuid = require('uuid/v4');

describe.skip('Worker - _gossipWith', () => {
  before(done => {
    helpers.prepareDatabase(mockData, done);
  });

  let aggregateHistory;
  let consensusApi;
  let genesisMergeHash;
  let getRecentHistory;
  let mergeBranches;
  let testEventId;
  const nodeCount = 4;
  // NOTE: alpha is assigned manually
  const nodeLabels = ['beta', 'gamma', 'delta', 'epsilon'];
  const nodes = {};
  const peers = {};
  beforeEach(function(done) {
    this.timeout(120000);
    const ledgerConfiguration = mockData.ledgerConfiguration;
    async.auto({
      clean: callback =>
        helpers.removeCollections(['ledger', 'ledgerNode'], callback),
      consensusPlugin: callback =>
        brLedgerNode.use('Continuity2017', (err, result) => {
          if(err) {
            return callback(err);
          }
          consensusApi = result.api;
          getRecentHistory = consensusApi._worker._events.getRecentHistory;
          mergeBranches = consensusApi._worker._events.mergeBranches;
          aggregateHistory = consensusApi._worker._events.aggregateHistory;
          callback();
        }),
      ledgerNode: ['clean', (results, callback) => brLedgerNode.add(
        null, {ledgerConfiguration}, (err, result) => {
          if(err) {
            return callback(err);
          }
          nodes.alpha = result;
          callback();
        })],
      genesisMerge: ['consensusPlugin', 'ledgerNode', (results, callback) => {
        consensusApi._worker._events._getLocalBranchHead({
          ledgerNodeId: results.ledgerNode.id,
          eventsCollection: nodes.alpha.storage.events.collection
        }, (err, result) => {
          if(err) {
            return callback(err);
          }
          genesisMergeHash = result;
          callback();
        });
      }],
      genesisBlock: ['ledgerNode', (results, callback) =>
        nodes.alpha.blocks.getGenesis((err, result) => {
          if(err) {
            return callback(err);
          }
          callback(null, result.genesisBlock.block);
        })],
      createNodes: ['genesisBlock', (results, callback) => {
        async.times(nodeCount - 1, (i, callback) => brLedgerNode.add(null, {
          genesisBlock: results.genesisBlock,
        }, (err, ledgerNode) => {
          if(err) {
            return callback(err);
          }
          nodes[nodeLabels[i]] = ledgerNode;
          callback();
        }), callback);
      }],
      getPeer: ['createNodes', (results, callback) =>
        async.eachOf(nodes, (ledgerNode, i, callback) =>
          consensusApi._worker._voters.get(ledgerNode.id, (err, result) => {
            peers[i] = result.id;
            callback();
          }), callback)],
    }, done);
  });
  /*
    gossip wih ledgerNode from nodes.beta, there is no merge event on
    ledgerNode beyond the genesis merge event, so the gossip should complete
    without an error.  There is also nothing to be sent.
  */
  it('completes without an error when nothing to be received or sent', done => {
    async.auto({
      gossipWith: callback => consensusApi._worker._gossipWith(
        {ledgerNode: nodes.beta, peerId: peers.alpha}, err => {
          assertNoError(err);
          callback();
        })
    }, done);
  });
  /*
    gossip wih ledgerNode from nodes.beta. There is a regular event and a
    merge event on ledgerNode to be gossiped.  There is nothing to be sent from
    nodes.beta.
  */
  it('properly gossips one regular event and one merge event', done => {
    const eventTemplate = mockData.events.alpha;
    async.auto({
      addEvent: callback => helpers.addEventAndMerge(
        {consensusApi, ledgerNode: nodes.alpha, eventTemplate}, callback),
      gossipWith: ['addEvent', (results, callback) =>
        consensusApi._worker._gossipWith(
          {ledgerNode: nodes.beta, peerId: peers.alpha}, err => {
            assertNoError(err);
            callback();
          })],
      test: ['gossipWith', (results, callback) => {
        // the events from ledgerNode should now be present on nodes.beta
        nodes.beta.storage.events.exists([
          Object.keys(results.addEvent.regular)[0],
          results.addEvent.mergeHash
        ], (err, result) => {
          assertNoError(err);
          result.should.be.true;
          callback();
        });
      }]
    }, done);
  });
  /*
    gossip wih ledgerNode from nodes.beta. There is a regular event and a
    merge event on ledgerNode to be gossiped. There is a regular event and a
    merge event from a fictitious node as well. There is nothing to be sent from
    nodes.beta.
  */
  it('properly gossips two regular events and two merge events', done => {
    const testEvent = bedrock.util.clone(mockData.events.alpha);
    testEventId = 'https://example.com/events/' + uuid();
    testEvent.operation[0].record.id = testEventId;
    async.auto({
      addEvent: callback => nodes.alpha.consensus._events.add(
        testEvent, nodes.alpha, callback),
      remoteEvents: callback => helpers.addRemoteEvents(
        {consensusApi, ledgerNode: nodes.alpha, mockData}, callback),
      history: ['addEvent', 'remoteEvents', (results, callback) =>
        getRecentHistory({ledgerNode: nodes.alpha}, callback)],
      mergeBranches: ['history', (results, callback) => mergeBranches(
        {history: results.history, ledgerNode: nodes.alpha}, callback)],
      gossipWith: ['mergeBranches', (results, callback) =>
        consensusApi._worker._gossipWith(
          {ledgerNode: nodes.beta, peerId: peers.alpha}, err => {
            assertNoError(err);
            callback();
          })],
      test: ['gossipWith', (results, callback) => {
        // the events from ledgerNode should now be present on nodes.beta
        nodes.beta.storage.events.exists([
          // results.remoteEvents.merge,
          // results.remoteEvents.regular,
          results.addEvent.meta.eventHash,
          results.mergeBranches.meta.eventHash
        ], (err, result) => {
          assertNoError(err);
          result.should.be.true;
          callback();
        });
      }]
    }, done);
  });
  /*
    gossip with ledgerNode from nodes.beta. There are no new events on
    ledgerNode, but nodes.beta has one regular event and one merge event
    to be push gossipped.
  */
  it('properly push gossips a regular event and a merge event', done => {
    const mergeBranches = consensusApi._worker._events.mergeBranches;
    const testEvent = bedrock.util.clone(mockData.events.alpha);
    testEventId = 'https://example.com/events/' + uuid();
    testEvent.operation[0].record.id = testEventId;
    async.auto({
      addEvent: callback => nodes.beta.consensus._events.add(
        testEvent, nodes.beta, callback),
      history: ['addEvent', (results, callback) =>
        getRecentHistory({ledgerNode: nodes.beta}, callback)],
      mergeBranches: ['history', (results, callback) => mergeBranches(
        {history: results.history, ledgerNode: nodes.beta}, callback)],
      gossipWith: ['mergeBranches', (results, callback) =>
        consensusApi._worker._gossipWith(
          {ledgerNode: nodes.beta, peerId: peers.alpha}, err => {
            assertNoError(err);
            callback();
          })],
      test: ['gossipWith', (results, callback) => {
        // the events from nodes.beta should now be present on ledgerNode
        nodes.alpha.storage.events.exists([
          results.addEvent.meta.eventHash,
          results.mergeBranches.meta.eventHash
        ], (err, result) => {
          assertNoError(err);
          result.should.be.true;
          callback();
        });
      }]
    }, done);
  });
  /*
    gossip wih ledgerNode from nodes.beta. There are no new events on
    ledgerNode, but there is a regular event and a merge event from ledgerNode
    as well as a regular event and merged event from a fictitious node on
    ledgerNode to be gossiped to nodes.beta.
  */
  it('properly push gossips two regular events and two merge events', done => {
    const mergeBranches = consensusApi._worker._events.mergeBranches;
    const testEvent = bedrock.util.clone(mockData.events.alpha);
    testEventId = 'https://example.com/events/' + uuid();
    testEvent.operation[0].record.id = testEventId;
    async.auto({
      addEvent: callback => nodes.beta.consensus._events.add(
        testEvent, nodes.beta, callback),
      remoteEvents: callback => helpers.addRemoteEvents(
        {consensusApi, ledgerNode: nodes.beta, mockData}, callback),
      history: ['addEvent', 'remoteEvents', (results, callback) =>
        getRecentHistory({ledgerNode: nodes.beta}, callback)],
      mergeBranches: ['history', (results, callback) => mergeBranches(
        {history: results.history, ledgerNode: nodes.beta}, callback)],
      gossipWith: ['mergeBranches', (results, callback) =>
        consensusApi._worker._gossipWith(
          {ledgerNode: nodes.beta, peerId: peers.alpha}, err => {
            assertNoError(err);
            callback();
          })],
      test: ['gossipWith', (results, callback) => {
        // the events from ledgerNode should now be present on nodes.beta
        nodes.alpha.storage.events.exists([
          results.remoteEvents.merge,
          results.remoteEvents.regular,
          results.addEvent.meta.eventHash,
          results.mergeBranches.meta.eventHash
        ], (err, result) => {
          assertNoError(err);
          result.should.be.true;
          callback();
        });
      }]
    }, done);
  });
  /*
    ledgerNode and nodes.beta each have unique local regular events.
    The also have the same set of regular event and merge event communicated
    to them by a fictitious node. ledgerNode and ledgeNodeBeta have eached
    merged the events from the fictitious node into their respective histories.
  */
  it('properly gossips in both directions', done => {
    const testNodes = [nodes.alpha, nodes.beta];
    const eventTemplate = mockData.events.alpha;
    async.auto({
      addEvent: callback => helpers.addEventAndMerge(
        {consensusApi, eventTemplate, ledgerNode: nodes.alpha}, callback),
      addEventBeta: callback => helpers.addEventAndMerge(
        {consensusApi, eventTemplate, ledgerNode: nodes.beta}, callback),
      gossipWith: ['addEvent', 'addEventBeta', (results, callback) =>
        consensusApi._worker._gossipWith(
          {ledgerNode: nodes.beta, peerId: peers.alpha}, err => {
            assertNoError(err);
            callback();
          })],
      test: ['gossipWith', (results, callback) => {
        // ledgerNode and ledgerNode beta should have the same events
        async.eachSeries(testNodes, (node, callback) =>
          node.storage.events.exists([
            ...results.addEvent.allHashes,
            ...results.addEventBeta.allHashes
          ], (err, result) => {
            assertNoError(err);
            result.should.be.true;
            callback();
          }), callback);
      }]
    }, done);
  });
  /*
    beta gossips with alpha, gamma gossips with alpha, beta gossips with gamma.
    Afterwards, all nodes have the same events.
  */
  it('properly gossips among three nodes', done => {
    const eventTemplate = mockData.events.alpha;
    const testNodes =
      {alpha: nodes.alpha, beta: nodes.beta, gamma: nodes.gamma};
    async.auto({
      addEvent: callback => helpers.addEventMultiNode(
        {consensusApi, eventTemplate, nodes: testNodes}, callback),
      gossipWith: ['addEvent', (results, callback) => async.series([
        // beta to alpha
        callback => consensusApi._worker._gossipWith(
          {ledgerNode: nodes.beta, peerId: peers.alpha}, err => {
            assertNoError(err);
            callback();
          }),
        // gamma to alpha
        callback => consensusApi._worker._gossipWith(
          {ledgerNode: nodes.gamma, peerId: peers.alpha}, err => {
            assertNoError(err);
            callback();
          }),
        // beta to gamma
        callback => consensusApi._worker._gossipWith(
          {ledgerNode: nodes.beta, peerId: peers.gamma}, (err, result) => {
            assertNoError(err);
            result.peerHistory.creatorHeads[peers.alpha]
              .should.equal(results.addEvent.alpha.mergeHash);
            result.peerHistory.creatorHeads[peers.beta]
              .should.equal(genesisMergeHash);
            result.peerHistory.creatorHeads[peers.gamma]
              .should.equal(results.addEvent.gamma.mergeHash);
            callback();
          }),
      ], callback)],
      count: ['gossipWith', (results, callback) => {
        async.eachOfSeries(testNodes, (ledgerNode, i, callback) => {
          ledgerNode.storage.events.collection.find({})
            .count((err, result) => {
              assertNoError(err);
              result.should.equal(8);
              callback();
            });
        }, callback);
      }],
      test: ['count', (results, callback) => {
        // all nodes should have the same events
        async.eachSeries(testNodes, (node, callback) =>
          node.storage.events.exists([
            ...results.addEvent.mergeHash,
            ...results.addEvent.regularHash
          ], (err, result) => {
            assertNoError(err);
            result.should.be.true;
            callback();
          }), callback);
      }]
    }, done);
  });
  it('properly selects events for push gossip', done => {
    const eventTemplate = mockData.events.alpha;
    async.auto({
      addEvent: callback => helpers.addEventMultiNode(
        {consensusApi, eventTemplate, nodes}, callback),
      // beta to alpha
      betaGossip1: ['addEvent', (results, callback) =>
        consensusApi._worker._gossipWith(
          {ledgerNode: nodes.beta, peerId: peers.alpha}, (err, result) => {
            assertNoError(err);
            result.peerHistory.creatorHeads[peers.beta]
              .should.equal(genesisMergeHash);
            result.peerHistory.history.should.have.length(1);
            result.peerHistory.history.should.have.same.members(
              [results.addEvent.alpha.mergeHash]);
            result.partitionHistory.history.should.have.length(2);
            result.partitionHistory.history
              .should.have.same.members(results.addEvent.beta.allHashes);
            callback();
          })],
      // beta to alpha again
      betaGossip2: ['betaGossip1', (results, callback) =>
        consensusApi._worker._gossipWith(
          {ledgerNode: nodes.beta, peerId: peers.alpha}, (err, result) => {
            assertNoError(err);
            // callerHead should be the merge event from addEvent
            result.peerHistory.creatorHeads[peers.beta]
              .should.equal(results.addEvent.beta.mergeHash);
            // no new events available from alpha
            result.peerHistory.history.should.have.length(0);
            // beta has no new events to send to alpha
            result.partitionHistory.history.should.have.length(0);
            callback();
          })],
      // add event on beta
      betaAddEvent1: ['betaGossip2', (results, callback) =>
        helpers.addEventAndMerge(
          {consensusApi, eventTemplate, ledgerNode: nodes.beta}, callback)],
      // alpha gossips with beta
      alphaGossip1: ['betaAddEvent1', (results, callback) =>
        consensusApi._worker._gossipWith(
          {ledgerNode: nodes.alpha, peerId: peers.beta}, (err, result) => {
            assertNoError(err);
            // callerHead should be the merge event from addEvent
            result.peerHistory.creatorHeads[peers.alpha]
              .should.equal(results.addEvent.alpha.mergeHash);
            result.peerHistory.creatorHeads[peers.beta]
              .should.equal(results.betaAddEvent1.mergeHash);
            // one new merge event event available from beta
            result.peerHistory.history.should.have.length(1);
            result.peerHistory.history.should.have.same.members(
              [results.betaAddEvent1.mergeHash]);
            // alpha has no new events to send to beta
            result.partitionHistory.history.should.have.length(0);
            callback();
          })],
      alphaAddEvent1: ['alphaGossip1', (results, callback) =>
        helpers.addEventAndMerge(
          {consensusApi, eventTemplate, ledgerNode: nodes.alpha}, callback)],
      alphaGossip2: ['alphaAddEvent1', (results, callback) =>
        consensusApi._worker._gossipWith(
          {ledgerNode: nodes.alpha, peerId: peers.beta}, (err, result) => {
            assertNoError(err);
            result.peerHistory.creatorHeads[peers.alpha]
              .should.equal(results.addEvent.alpha.mergeHash);
            result.peerHistory.history.should.have.length(0);
            // alpha has two new events to send to beta
            result.partitionHistory.history.should.have.length(2);
            result.partitionHistory.history.should.have.same.members(
              results.alphaAddEvent1.allHashes);
            callback();
          })],
      test1: ['alphaGossip2', (results, callback) => async.series([
        callback => nodes.alpha.storage.events.collection.find({})
          .count((err, result) => {
            assertNoError(err);
            result.should.equal(10);
            callback();
          }),
        callback => nodes.beta.storage.events.collection.find({})
          .count((err, result) => {
            assertNoError(err);
            result.should.equal(10);
            callback();
          }),
      ], callback)],
      alphaGossip3: ['test1', (results, callback) =>
        consensusApi._worker._gossipWith(
          {ledgerNode: nodes.alpha, peerId: peers.beta}, (err, result) => {
            assertNoError(err);
            result.peerHistory.creatorHeads[peers.alpha]
              .should.equal(results.alphaAddEvent1.mergeHash);
            result.peerHistory.history.should.have.length(0);
            result.partitionHistory.history.should.have.length(0);
            callback();
          })],
      // gamma gossips with alpha for the first time
      gammaGossip1: ['alphaGossip3', (results, callback) =>
        consensusApi._worker._gossipWith(
          {ledgerNode: nodes.gamma, peerId: peers.alpha}, (err, result) => {
            assertNoError(err);
            result.peerHistory.creatorHeads[peers.gamma]
              .should.equal(genesisMergeHash);
            result.peerHistory.history.should.have.length(4);
            result.peerHistory.history.should.have.same.members([
              results.addEvent.alpha.mergeHash,
              results.addEvent.beta.mergeHash,
              results.alphaAddEvent1.mergeHash,
              results.betaAddEvent1.mergeHash
            ]);
            result.partitionHistory.history.should.have.length(2);
            result.partitionHistory.history.should.have.same.members(
              results.addEvent.gamma.allHashes);
            callback();
          })],
      gammaGossip2: ['gammaGossip1', (results, callback) =>
        consensusApi._worker._gossipWith(
          {ledgerNode: nodes.gamma, peerId: peers.alpha}, (err, result) => {
            assertNoError(err);
            result.peerHistory.creatorHeads[peers.gamma]
              .should.equal(results.addEvent.gamma.mergeHash);
            result.peerHistory.history.should.have.length(0);
            result.partitionHistory.history.should.have.length(0);
            callback();
          })],
      // // gamma gossips with beta for the first time
      // // gamma has all of beta's history from gossiping with alpha
      gammaGossip4: ['gammaGossip2', (results, callback) =>
        consensusApi._worker._gossipWith(
          {ledgerNode: nodes.gamma, peerId: peers.beta}, (err, result) => {
            assertNoError(err);
            result.peerHistory.creatorHeads[peers.gamma]
              .should.equal(genesisMergeHash);
            result.peerHistory.history.should.have.length(0);
            result.partitionHistory.history.should.have.length(2);
            result.partitionHistory.history.should.have.same.members(
              results.addEvent.gamma.allHashes);
            callback();
          })],
      gammaAddEvent1: ['gammaGossip4', (results, callback) =>
        helpers.addEventAndMerge(
          {consensusApi, eventTemplate, ledgerNode: nodes.gamma}, callback)],
      test2: ['gammaAddEvent1', (results, callback) => async.auto({
        betaViewBeta: callback => aggregateHistory({
          eventTypeFilter: 'ContinuityMergeEvent',
          ledgerNode: nodes.beta,
          startHash: results.betaAddEvent1.mergeHash,
        }, callback),
        gammaViewBeta: callback => aggregateHistory({
          eventTypeFilter: 'ContinuityMergeEvent',
          ledgerNode: nodes.gamma,
          startHash: results.betaAddEvent1.mergeHash,
        }, callback),
      }, (err, results2) => {
        if(err) {
          return callback(err);
        }
        results2.betaViewBeta.should.have.same.members(results2.gammaViewBeta);
        callback(null, results);
      })],
      gammaGossip5: ['gammaAddEvent1', (results, callback) =>
        consensusApi._worker._gossipWith(
          {ledgerNode: nodes.gamma, peerId: peers.beta}, (err, result) => {
            assertNoError(err);
            result.peerHistory.creatorHeads[peers.gamma]
              .should.equal(results.addEvent.gamma.mergeHash);
            result.peerHistory.creatorHeads[peers.alpha]
              .should.equal(results.alphaAddEvent1.mergeHash);
            result.peerHistory.history.should.have.length(0);
            result.partitionHistory.history.should.have.length(2);
            result.partitionHistory.history.should.have.same.members([
              ...results.gammaAddEvent1.allHashes
            ]);
            callback();
          })],
    }, (err, results) => {
      if(err) {
        return done(err);
      }
      // console.log('GGGGGenesisMerge', genesisMergeHash);
      // console.log('AddEventMerge', results.addEvent.mergeHash);
      // console.log('AddEventRegular', results.addEvent.regularHash);
      // Object.keys(results).forEach(k => {
      //   if(!k.includes('AddEvent')) {
      //     return;
      //   }
      //   console.log('KKKKKK', k);
      //   console.log('Merge', results[k].mergeHash);
      //   console.log('Regular', results[k].regularHashes);
      // });
      done(null, results);
    });
  }); // end it
  it('performs gossip-cycle alpha 100 times', function(done) {
    this.timeout(120000);
    const eventTemplate = mockData.events.alpha;
    let previousResult;
    async.timesSeries(100, (i, callback) => {
      gossipCycle.alpha(
        {consensusApi, eventTemplate, nodes, peers, previousResult},
        (err, result) => {
          if(err) {
            return callback(err);
          }
          previousResult = result;
          callback();
        });
    }, err => {
      if(err) {
        return done(err);
      }
      done();
    });
  }); // end cycle alpha
  it('performs gossip cycle beta 100 times', function(done) {
    this.timeout(120000);
    const eventTemplate = mockData.events.alpha;
    let previousResult;
    async.timesSeries(100, (i, callback) => {
      gossipCycle.beta(
        {consensusApi, eventTemplate, nodes, peers, previousResult},
        (err, result) => {
          if(err) {
            return callback(err);
          }
          previousResult = result;
          callback();
        });
    }, err => {
      if(err) {
        return done(err);
      }
      done();
    });
  }); // end cycle beta
  it('performs gossip cycle gamma 100 times', function(done) {
    this.timeout(120000);
    const eventTemplate = mockData.events.alpha;
    let previousResult;
    async.timesSeries(100, (i, callback) => {
      gossipCycle.gamma(
        {consensusApi, eventTemplate, nodes, peers, previousResult},
        (err, result) => {
          if(err) {
            return callback(err);
          }
          previousResult = result;
          callback();
        });
    }, err => {
      if(err) {
        return done(err);
      }
      done();
    });
  }); // end cycle gamma
  it('performs gossip cycle delta 100 times', function(done) {
    this.timeout(120000);
    const eventTemplate = mockData.events.alpha;
    let previousResult;
    async.timesSeries(100, (i, callback) => {
      gossipCycle.delta(
        {consensusApi, eventTemplate, nodes, peers, previousResult},
        (err, result) => {
          if(err) {
            return callback(err);
          }
          previousResult = result;
          callback();
        });
    }, err => {
      if(err) {
        return done(err);
      }
      done();
    });
  }); // end cycle delta
});
